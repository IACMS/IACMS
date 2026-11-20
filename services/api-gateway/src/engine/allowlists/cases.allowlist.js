export default {
  prismaModel: 'case',
  selectableFields: [
    'id', 'caseNumber', 'title', 'status', 'priority', 'type',
    'dueDate', 'createdAt', 'updatedAt', 'closedAt', 'description', 'referralStatus',
  ],
  filterableFields: {
    status:         { operators: ['eq', 'in', 'neq'] },
    priority:       { operators: ['eq', 'in', 'neq'] },
    type:           { operators: ['eq', 'in', 'neq'] },
    referralStatus: { operators: ['eq', 'in', 'neq'] },
    createdAt:      { operators: ['gte', 'lte', 'gt', 'lt'] },
    updatedAt:      { operators: ['gte', 'lte', 'gt', 'lt'] },
    dueDate:        { operators: ['gte', 'lte', 'gt', 'lt'] },
    title:          { operators: ['contains'] },
    caseNumber:     { operators: ['eq', 'contains'] },
  },
  relations: {
    assignee:              { prismaRelation: 'assignee',              selectableFields: ['firstName', 'lastName', 'email'] },
    currentStep:           { 
      prismaRelation: 'currentStep', 
      selectableFields: ['name', 'key', 'isFinal', 'isInitial', 'position'],
      relations: {
        actions: { prismaRelation: 'actions', selectableFields: ['name', 'key'] }
      }
    },
    workflow:              { 
      prismaRelation: 'workflow', 
      selectableFields: ['name', 'key', 'version', 'status'],
      relations: {
        steps: { prismaRelation: 'steps', selectableFields: ['name', 'key', 'position'] }
      }
    },
    originatingDepartment: { prismaRelation: 'originatingDepartment', selectableFields: ['name', 'code'] },
    currentDepartment:     { prismaRelation: 'currentDepartment',     selectableFields: ['name', 'code'] },
    creator:               { prismaRelation: 'creator',               selectableFields: ['firstName', 'lastName'] },
  },
  // Max 3 relation depth
  maxRelationDepth: 3,
  // Records with deletedAt set should never be returned to partners
  softDelete: true,
};
