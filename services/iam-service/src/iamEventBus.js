import { Kafka, logLevel } from 'kafkajs';

// Topic names remain a contract with the current IACMS event consumers.
export const TOPICS = Object.freeze({
  AUDIT_LOG: 'audit.log',
  EMAIL_VERIFICATION_REQUESTED: 'email.verification.requested',
  PASSWORD_CHANGED: 'password.changed',
  PASSWORD_RESET_REQUESTED: 'password.reset.requested',
  TENANT_APPROVED: 'tenant.approved',
  USER_CREATED: 'user.created',
  USER_LOGGED_IN: 'user.logged_in',
  USER_UPDATED: 'user.updated',
});

/** IAM publishes events; downstream services own event consumption. */
export default class EventBus {
  constructor(brokers = process.env.KAFKA_BROKERS || 'localhost:9092', serviceId = 'iam-service') {
    this.serviceId = serviceId;
    this.kafka = new Kafka({
      clientId: serviceId,
      brokers: brokers.split(',').map((broker) => broker.trim()).filter(Boolean),
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 3000, retries: 5, maxRetryTime: 30000 },
    });
    this.producer = this.kafka.producer();
    this.connected = false;
  }
  async publish(type, data) {
    try {
      if (!this.connected) { await this.producer.connect(); this.connected = true; }
      await this.producer.send({
        topic: type,
        messages: [{ key: data?.tenantId || data?.id || null, value: JSON.stringify({ type, data, timestamp: new Date().toISOString(), serviceId: this.serviceId }) }],
      });
    } catch (error) {
      console.warn(`[IAM EventBus] Failed to publish event "${type}":`, error.message);
    }
  }
  async close() {
    if (this.connected) { await this.producer.disconnect(); this.connected = false; }
  }
}
