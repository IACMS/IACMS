export default {
  prismaModel: 'workflowStep',
  selectableFields: [
    'id', 'key', 'name', 'description', 'isInitial', 'isFinal', 'position', 'createdAt'
  ],
  filterableFields: {
    key: { operators: ['eq'] },
    isInitial: { operators: ['eq'] },
    isFinal: { operators: ['eq'] },
  },
  relations: {
    workflow: { prismaRelation: 'workflow', selectableFields: ['name', 'key', 'version'] },
  },
};
