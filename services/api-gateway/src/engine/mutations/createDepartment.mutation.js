import { z } from 'zod';
import { BusinessRuleViolationError } from '../../../../../shared/common/errors.js';

export const schema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const requiredScope = 'departments:create';

export async function execute(data, context) {
  const { tenantId, prisma, apiKeyId } = context;

  const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { createdBy: true } });
  const actorUserId = apiKey.createdBy;

  return await prisma.$transaction(async (tx) => {
    // 1. Check uniqueness of code and name within tenant
    const existingCode = await tx.department.findUnique({ where: { tenantId_code: { tenantId, code: data.code } } });
    if (existingCode) throw new BusinessRuleViolationError(`Department with code "${data.code}" already exists.`);

    const existingName = await tx.department.findUnique({ where: { tenantId_name: { tenantId, name: data.name } } });
    if (existingName) throw new BusinessRuleViolationError(`Department with name "${data.name}" already exists.`);

    // 2. Create the department
    const department = await tx.department.create({
      data: {
        tenantId,
        code: data.code,
        name: data.name,
        description: data.description,
        isActive: true,
      },
    });

    return {
      departmentId: department.id,
      code: department.code,
      name: department.name,
    };
  });
}
