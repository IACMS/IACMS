export default {
  prismaModel: 'caseReferral',
  selectableFields: [
    'id', 'referralReason', 'notes', 'status', 'referredAt', 'acceptedAt', 'rejectedAt', 'completedAt'
  ],
  filterableFields: {
    status: { operators: ['eq', 'in'] },
    referredAt: { operators: ['gte', 'lte'] },
  },
  relations: {
    case: { prismaRelation: 'case', selectableFields: ['caseNumber', 'title', 'status'] },
    fromTenant: { prismaRelation: 'fromTenant', selectableFields: ['name', 'code'] },
    toTenant: { prismaRelation: 'toTenant', selectableFields: ['name', 'code'] },
    referrer: { prismaRelation: 'referrer', selectableFields: ['firstName', 'lastName'] },
  },
};
