export default {
  prismaModel: 'case',
  selectableFields: [
    'id', 'caseNumber', 'title', 'status', 'priority', 'type',
    'dueDate', 'createdAt', 'updatedAt', 'closedAt', 'description', 'referralStatus',
  ],
  filterableFields: {
    status:         { operators: ['eq', 'in'] },
    priority:       { operators: ['eq', 'in'] },
    type:           { operators: ['eq', 'in'] },
    referralStatus: { operators: ['eq', 'in'] },
    createdAt:      { operators: ['gte', 'lte'] },
    updatedAt:      { operators: ['gte', 'lte'] },
    dueDate:        { operators: ['gte', 'lte'] },
    title:          { operators: ['contains'] },
    caseNumber:     { operators: ['eq', 'contains'] },
  },
  relations: {
    assignee:              { prismaRelation: 'assignee',              selectableFields: ['firstName', 'lastName', 'email'] },
    currentStep:           { prismaRelation: 'currentStep',           selectableFields: ['name', 'key', 'isFinal', 'isInitial', 'position'] },
    workflow:              { prismaRelation: 'workflow',              selectableFields: ['name', 'key', 'version', 'status'] },
    originatingDepartment: { prismaRelation: 'originatingDepartment', selectableFields: ['name', 'code'] },
    currentDepartment:     { prismaRelation: 'currentDepartment',     selectableFields: ['name', 'code'] },
    creator:               { prismaRelation: 'creator',               selectableFields: ['firstName', 'lastName'] },
  },
  // Max 3 relation depth
  maxRelationDepth: 1,
};
