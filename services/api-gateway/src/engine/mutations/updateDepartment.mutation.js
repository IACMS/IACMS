import { z } from 'zod';
import { BusinessRuleViolationError, NotFoundError } from '../../../../../shared/common/errors.js';

export const schema = z.object({
  departmentId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
});

export const requiredScope = 'departments:update';

export async function execute(data, context) {
  const { tenantId, prisma, apiKeyId } = context;

  const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { createdBy: true } });
  const actorUserId = apiKey.createdBy;

  return await prisma.$transaction(async (tx) => {
    // 1. Check if department exists
    const department = await tx.department.findUnique({ where: { id: data.departmentId } });
    if (!department || department.tenantId !== tenantId) throw new NotFoundError('Department');

    // 2. Check name uniqueness if name is updated
    if (data.name && data.name !== department.name) {
      const existingName = await tx.department.findUnique({ where: { tenantId_name: { tenantId, name: data.name } } });
      if (existingName) throw new BusinessRuleViolationError(`Department with name "${data.name}" already exists.`);
    }

    // 3. Update the department
    const updatedDepartment = await tx.department.update({
      where: { id: data.departmentId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    return {
      departmentId: updatedDepartment.id,
      code: updatedDepartment.code,
      name: updatedDepartment.name,
      isActive: updatedDepartment.isActive,
    };
  });
}
