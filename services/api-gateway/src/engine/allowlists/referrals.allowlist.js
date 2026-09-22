export default {
  prismaModel: 'caseReferral',
  selectableFields: [
    'id', 'referralReason', 'notes', 'status', 'referredAt', 'acceptedAt', 'rejectedAt', 'completedAt'
  ],
  filterableFields: {
    status:     { operators: ['eq', 'in', 'neq'] },
    referredAt: { operators: ['gte', 'lte', 'gt', 'lt'] },
  },
  relations: {
    case: { prismaRelation: 'case', selectableFields: ['caseNumber', 'title', 'status'], softDelete: true },
    fromTenant: { prismaRelation: 'fromTenant', selectableFields: ['name', 'code'] },
    toTenant: { prismaRelation: 'toTenant', selectableFields: ['name', 'code'] },
    referrer: { prismaRelation: 'referrer', selectableFields: ['firstName', 'lastName'] },
  },
};
