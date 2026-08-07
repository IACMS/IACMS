import prisma from '../config/database.js';

/**
 * Format {tenantCode}-{YYYY}-{seq padded 5}; uses row-lock on case_sequences.
 */
export async function generateCaseNumber(tenantId) {
  const year = new Date().getFullYear();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error('Tenant not found for case numbering');

  return prisma.$transaction(async tx => {
    const seqRow = await tx.caseSequence.upsert({
      where: {
        tenantId_year: { tenantId, year },
      },
      update: { lastSeq: { increment: 1 } },
      create: { tenantId, year, lastSeq: 1 },
    });
    const seqPart = String(seqRow.lastSeq).padStart(5, '0');
    return `${tenant.code}-${year}-${seqPart}`;
  });
}
