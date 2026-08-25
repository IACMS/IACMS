export default {
  prismaModel: 'auditLog',
  selectableFields: [
    'id', 'entityType', 'entityId', 'action', 'ipAddress', 'userAgent', 'createdAt'
  ],
  filterableFields: {
    entityType: { operators: ['eq', 'in'] },
    action: { operators: ['eq', 'in'] },
    createdAt: { operators: ['gte', 'lte'] },
    entityId: { operators: ['eq'] },
  },
  relations: {
    user: { prismaRelation: 'user', selectableFields: ['firstName', 'lastName', 'email'] },
  },
};
