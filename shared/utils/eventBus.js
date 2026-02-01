/**
 * Shared Event Bus for Inter-Service Communication
 * Uses Redis Pub/Sub for event-driven architecture
 */

import Redis from 'ioredis';

class EventBus {
  constructor(redisUrl) {
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
    this.handlers = new Map();
  }

  /**
   * Publish an event
   */
  async publish(eventType, data) {
    const event = {
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
    };

    await this.publisher.publish('events', JSON.stringify(event));
  }

  /**
   * Subscribe to events
   */
  async subscribe(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(handler);

    // Start listening if not already started
    if (this.handlers.size === 1) {
      this.subscriber.subscribe('events');
      this.subscriber.on('message', (channel, message) => {
        const event = JSON.parse(message);
        const handlers = this.handlers.get(event.type) || [];
        handlers.forEach(handler => handler(event.data));
      });
    }
  }

  /**
   * Unsubscribe from events
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
   * Close connections
   */
  async close() {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}

export default EventBus;

