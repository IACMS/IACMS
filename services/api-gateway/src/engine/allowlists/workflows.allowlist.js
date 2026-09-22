export default {
  prismaModel: 'workflow',
  selectableFields: [
    'id', 'key', 'name', 'description', 'version', 'status', 'publishedAt', 'isActive', 'isDefault', 'createdAt'
  ],
  filterableFields: {
    status: { operators: ['eq', 'in'] },
    key: { operators: ['eq', 'contains'] },
    isActive: { operators: ['eq'] },
    version: { operators: ['eq'] },
  },
  relations: {
    department: { prismaRelation: 'department', selectableFields: ['name', 'code'] },
    steps: { prismaRelation: 'steps', selectableFields: ['name', 'key', 'isInitial', 'isFinal', 'position'] },
  },
};
