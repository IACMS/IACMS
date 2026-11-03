import prisma from '../config/database.js';

/**
 * Format {tenantCode}-{YYYY}-{seq padded 5}; uses row-lock on case_sequences.
 * Can be executed within an existing transaction (tx) or standalone using the prisma client.
 */
export async function generateCaseNumber(tenantId, txOrPrisma = prisma) {
  const year = new Date().getFullYear();
  const tenant = await txOrPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error('Tenant not found for case numbering');

  const executeUpsert = async (client) => {
    const seqRow = await client.caseSequence.upsert({
      where: {
        tenantId_year: { tenantId, year },
      },
      update: { lastSeq: { increment: 1 } },
      create: { tenantId, year, lastSeq: 1 },
    });
    const seqPart = String(seqRow.lastSeq).padStart(5, '0');
    return `${tenant.code}-${year}-${seqPart}`;
  };

  if (txOrPrisma === prisma) {
    return prisma.$transaction(async (tx) => executeUpsert(tx));
  }
  return executeUpsert(txOrPrisma);
}
