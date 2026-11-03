import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCaseNumber } from '../../src/utils/case-number.js';

describe('generateCaseNumber utility', () => {
  let mockPrisma;

  beforeEach(() => {
    mockPrisma = {
      tenant: {
        findUnique: vi.fn(),
      },
      caseSequence: {
        upsert: vi.fn(),
      },
      $transaction: vi.fn(async (callback) => callback(mockPrisma)),
    };
  });

  it('generates the first case number correctly with padded sequence', async () => {
    const tenantId = 'tenant-uuid-1';
    const currentYear = new Date().getFullYear();

    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      code: 'POLICE',
    });

    mockPrisma.caseSequence.upsert.mockResolvedValue({
      tenantId,
      year: currentYear,
      lastSeq: 1,
    });

    const caseNumber = await generateCaseNumber(tenantId, mockPrisma);

    expect(caseNumber).toBe(`POLICE-${currentYear}-00001`);
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: tenantId },
    });
    expect(mockPrisma.caseSequence.upsert).toHaveBeenCalledWith({
      where: { tenantId_year: { tenantId, year: currentYear } },
      update: { lastSeq: { increment: 1 } },
      create: { tenantId, year: currentYear, lastSeq: 1 },
    });
  });

  it('formats padded sequence for subsequent sequence numbers', async () => {
    const tenantId = 'tenant-uuid-2';
    const currentYear = new Date().getFullYear();

    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      code: 'COURT',
    });

    mockPrisma.caseSequence.upsert.mockResolvedValue({
      tenantId,
      year: currentYear,
      lastSeq: 42,
    });

    const caseNumber = await generateCaseNumber(tenantId, mockPrisma);
    expect(caseNumber).toBe(`COURT-${currentYear}-00042`);
  });

  it('throws an error if the tenant is not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(generateCaseNumber('unknown-tenant', mockPrisma)).rejects.toThrow(
      'Tenant not found for case numbering',
    );
  });
});

