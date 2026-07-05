/**
 * Regression — referral event contract fixture shape (CaseReferral model events).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../../shared/contracts/__fixtures__/referral.example.json'),
    'utf8',
  ),
);

describe('CaseReferral event contract regression', () => {
  it('fixture includes required referral fields', () => {
    expect(fixture.status).toBe('pending');
    expect(fixture.fromTenantId).toBeTruthy();
    expect(fixture.toTenantId).toBeTruthy();
    expect(fixture.caseId).toBeTruthy();
    expect(fixture.referredBy).toBeTruthy();
  });

  it('status values remain lowercase enum strings', () => {
    expect(['pending', 'accepted', 'rejected', 'completed']).toContain(fixture.status);
  });
});
