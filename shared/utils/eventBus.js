/**
 * Shared Event Bus for Inter-Service Communication
 * Uses Apache Kafka for reliable, persistent event streaming
 *
 * Why Kafka over Redis Pub/Sub:
 * - Messages are persisted (not lost if a service is down)
 * - Consumers can replay missed events
 * - Guaranteed delivery with consumer groups
 * - Each event type has its own topic for better isolation
 */

import { Kafka, logLevel } from 'kafkajs';

// All event topics used across services
export const TOPICS = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  CASE_CREATED: 'case.created',
  CASE_UPDATED: 'case.updated',
  CASE_ASSIGNED: 'case.assigned',
  CASE_TRANSITIONED: 'case.transitioned',
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_UPDATED: 'workflow.updated',
  WORKFLOW_PUBLISHED: 'workflow.published',
  WORKFLOW_ARCHIVED: 'workflow.archived',
  REFERRAL_CREATED: 'referral.created',
  REFERRAL_ACCEPTED: 'referral.accepted',
  REFERRAL_REJECTED: 'referral.rejected',
  REFERRAL_COMPLETED: 'referral.completed',
  INTEGRATION_CREATED: 'integration.created',
  INTEGRATION_UPDATED: 'integration.updated',
  INTEGRATION_SYNC: 'integration.sync',
  WEBHOOK_CREATED: 'webhook.created',
  WEBHOOK_UPDATED: 'webhook.updated',
  WEBHOOK_TEST: 'webhook.test',
  AUDIT_LOG: 'audit.log',
  USER_LOGGED_IN: 'user.logged_in',
  EMAIL_VERIFICATION_REQUESTED: 'email.verification.requested',
  PASSWORD_RESET_REQUESTED: 'password.reset.requested',
  PASSWORD_CHANGED: 'password.changed',
};

class EventBus {
  /**
   * @param {string} brokers - Comma-separated Kafka broker addresses (e.g. "localhost:9092")
   * @param {string} serviceId - Unique name for this service (used as Kafka client ID and consumer group)
   */
  constructor(brokers, serviceId = 'iacms-service') {
    const brokerList = brokers
      ? brokers.split(',').map(b => b.trim())
      : ['localhost:9092'];

    this.kafka = new Kafka({
      clientId: serviceId,
      brokers: brokerList,
      // Suppress verbose Kafka internal logs in development
      logLevel: logLevel.WARN,
      // Retry settings - allow services to start before Kafka is ready
      retry: {
        initialRetryTime: 3000,
        retries: 5,
        maxRetryTime: 30000,
      },
    });

    this.serviceId = serviceId;
    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ groupId: serviceId });
    this.handlers = new Map();
    this.connected = false;
    this.consumerConnected = false;
  }

  /**
   * Connect producer to Kafka
   * Called lazily on first publish
   */
  async connectProducer() {
    if (!this.connected) {
      await this.producer.connect();
      this.connected = true;
    }
  }

  /**
   * Publish an event to a Kafka topic
   *
   * @param {string} eventType - The event topic (e.g. 'case.created')
   * @param {object} data - The event payload
   */
  async publish(eventType, data) {
    try {
      await this.connectProducer();

      const event = {
        type: eventType,
        data,
        timestamp: new Date().toISOString(),
        serviceId: this.serviceId,
      };

      await this.producer.send({
        topic: eventType,
        messages: [
          {
            // Use a partition key for ordering (e.g. tenantId or caseId if available)
            key: data?.tenantId || data?.id || null,
            value: JSON.stringify(event),
          },
        ],
      });
    } catch (error) {
      // Non-blocking: log error but don't crash the service
      console.warn(`[EventBus] Failed to publish event "${eventType}":`, error.message);
    }
  }

  /**
   * Subscribe to an event topic.
   * Uses a deferred start so that all topics registered in the same tick
   * are bundled into a single consumer.connect() call.
   *
   * @param {string} eventType - The event topic to subscribe to
   * @param {function} handler - Callback function(data) called when event arrives
   */
  async subscribe(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(handler);

    // If the consumer is already running, subscribe immediately to the new topic.
    // This avoids the "only first topic subscribed" issue when services register
    // multiple subscriptions sequentially (e.g., with await between calls).
    if (this.consumerConnected) {
      try {
        await this.consumer.subscribe({ topic: eventType, fromBeginning: false });
      } catch (error) {
        console.warn(`[EventBus] Failed to subscribe to topic "${eventType}":`, error.message);
      }
      return;
    }

    // Defer consumer start so all synchronous subscribe() calls are collected
    // before we connect, ensuring every topic is registered with Kafka.
    if (!this._connectingPromise) {
      this._connectingPromise = new Promise(resolve => setImmediate(resolve))
        .then(() => this._startConsumer());
    }

    return this._connectingPromise;
  }

  /**
   * Internal: Connect consumer and start processing messages.
   * Only called once; all handlers registered by then are included.
   */
  async _startConsumer() {
    if (this.consumerConnected) return;
    try {
      await this.consumer.connect();
      this.consumerConnected = true;

      // Absorb internal KafkaJS crashes so they don't become unhandled rejections
      this.consumer.on(this.consumer.events.CRASH, ({ payload }) => {
        console.warn('[EventBus] Consumer crash event:', payload?.error?.message);
        this.consumerConnected = false;
        this._connectingPromise = null;
      });

      for (const topic of this.handlers.keys()) {
        await this.consumer.subscribe({ topic, fromBeginning: false });
      }

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const event = JSON.parse(message.value.toString());
            const handlers = this.handlers.get(topic) || [];
            for (const handler of handlers) {
              await handler(event.data);
            }
          } catch (error) {
            console.error(`[EventBus] Error processing message from topic "${topic}":`, error.message);
          }
        },
      });
    } catch (error) {
      console.warn('[EventBus] Consumer connection failed:', error.message);
      this.consumerConnected = false;
      this._connectingPromise = null; // allow retry on next subscribe call
    }
  }

  /**
   * Remove a specific handler from a topic
   */
  unsubscribe(eventType, handler) {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Gracefully disconnect from Kafka
   */
  async close() {
    try {
      if (this.connected) {
        await this.producer.disconnect();
        this.connected = false;
      }
      if (this.consumerConnected) {
        await this.consumer.disconnect();
        this.consumerConnected = false;
      }
    } catch (error) {
      console.warn('[EventBus] Error during shutdown:', error.message);
    }
  }
}

export default EventBus;
