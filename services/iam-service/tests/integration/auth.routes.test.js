import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import authRoutes from '../../src/routes/auth.routes.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../src/controllers/auth/auth.session.controller.js', () => ({
  login: (req, res) => res.status(401).json({ error: 'Invalid credentials' }),
  refreshToken: (req, res) => res.json({ token: 'new-token' }),
  logout: (req, res) => res.json({ message: 'Logged out' }),
}));

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

describe('IAM Auth Routes Integration', () => {
  it('POST /auth/login returns credentials error on failed login', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'fake@iacms.org', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
  });

  it('POST /auth/refresh returns refreshed token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'new-token' });
  });
});
