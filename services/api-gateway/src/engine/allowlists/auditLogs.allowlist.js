export default {
  prismaModel: 'auditLog',
  selectableFields: [
    'id', 'entityType', 'entityId', 'action', 'ipAddress', 'userAgent', 'createdAt'
  ],
  filterableFields: {
    entityType: { operators: ['eq', 'in', 'neq'] },
    action:     { operators: ['eq', 'in', 'neq'] },
    createdAt:  { operators: ['gte', 'lte', 'gt', 'lt'] },
    entityId:   { operators: ['eq'] },
  },
  relations: {
    user: { prismaRelation: 'user', selectableFields: ['firstName', 'lastName', 'email'] },
  },
};
