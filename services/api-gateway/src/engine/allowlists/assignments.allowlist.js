export default {
  prismaModel: 'assignment',
  selectableFields: [
    'id', 'assignmentType', 'notes', 'assignedAt', 'unassignedAt', 'isActive'
  ],
  filterableFields: {
    isActive: { operators: ['eq'] },
    assignedAt: { operators: ['gte', 'lte'] },
  },
  relations: {
    case: { prismaRelation: 'case', selectableFields: ['caseNumber', 'title'] },
    assignee: { prismaRelation: 'assignee', selectableFields: ['firstName', 'lastName', 'email'] },
    assigner: { prismaRelation: 'assigner', selectableFields: ['firstName', 'lastName'] },
  },
};
