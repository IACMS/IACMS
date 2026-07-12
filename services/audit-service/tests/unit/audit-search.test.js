import { describe, it, expect } from 'vitest';
import { buildAuditSearchOr } from '../../src/controllers/audit.controller.js';

describe('buildAuditSearchOr', () => {
  it('includes text fields for generic search', () => {
    const or = buildAuditSearchOr('case');
    expect(or).toEqual(
      expect.arrayContaining([
        { action: { contains: 'case', mode: 'insensitive' } },
        { entityType: { contains: 'case', mode: 'insensitive' } },
        { user: { email: { contains: 'case', mode: 'insensitive' } } },
      ]),
    );
    expect(or.some((clause) => 'entityId' in clause)).toBe(false);
  });

  it('matches full UUIDs on entityId and userId', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const or = buildAuditSearchOr(id);
    expect(or).toEqual(
      expect.arrayContaining([{ entityId: id }, { userId: id }]),
    );
  });
});
