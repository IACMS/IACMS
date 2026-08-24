import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../src/config/database.js', () => ({
  default: {
    case: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'c-1', caseNumber: 'CAS-001', title: 'Test Case 1' },
      ]),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../../../shared/utils/eventBus.js', () => ({
  default: vi.fn().mockImplementation(function () {
    this.publish = vi.fn().mockResolvedValue(true);
  }),
  TOPICS: { AUDIT_LOG: 'audit.log' },
}));

import caseRoutes from '../../src/routes/case.routes.js';
import { errorHandler } from '../../../../shared/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/cases', caseRoutes);
app.use(errorHandler);

describe('Case Engine Routes Integration', () => {
  it('GET /cases requires x-tenant-id header', async () => {
    const res = await request(app).get('/cases');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/x-tenant-id header required/);
  });

  it('GET /cases returns list of cases when header is present', async () => {
    const res = await request(app)
      .get('/cases')
      .set('x-tenant-id', 'tenant-001');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cases');
    expect(res.body.cases.length).toBe(1);
    expect(res.body.cases[0].caseNumber).toBe('CAS-001');
  });
});
