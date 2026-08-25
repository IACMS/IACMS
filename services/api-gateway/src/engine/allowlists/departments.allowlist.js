export default {
  prismaModel: 'department',
  selectableFields: [
    'id', 'code', 'name', 'description', 'isActive', 'createdAt'
  ],
  filterableFields: {
    code: { operators: ['eq', 'contains'] },
    isActive: { operators: ['eq'] },
    name: { operators: ['contains'] },
  },
  relations: {},
};
