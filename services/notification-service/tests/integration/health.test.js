/**
 * Integration tests — notification service health (no DB models).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app;

beforeAll(async () => {
  ({ default: app } = await import('../../src/server.js'));
});

describe('Notification service integration', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('notification-service');
  });
});
