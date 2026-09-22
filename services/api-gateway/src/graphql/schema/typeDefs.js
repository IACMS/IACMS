/**
 * GraphQL SDL Type Definitions
 *
 * Derived from the existing allowlist registry and mutation schemas.
 * Entities and their fields map 1:1 to allowlist selectableFields + relations.
 * Mutation inputs map 1:1 to the Zod schemas in each *.mutation.js file.
 */
import gql from 'graphql-tag';

export const typeDefs = gql`
  scalar DateTime

  # ─── Directives ──────────────────────────────────────────────────────────────

  """Require the caller's API key to hold the specified scope."""
  directive @requireScope(scope: String!) on FIELD_DEFINITION

  # ─── Shared ──────────────────────────────────────────────────────────────────

  type PaginationInfo {
    total: Int!
    limit: Int!
    offset: Int!
    hasMore: Boolean!
  }

  type QueryMeta {
    executionTimeMs: Int!
    requestId: String!
  }

  input Pagination {
    """Maximum number of records to return (1–100, default 20)."""
    limit: Int = 20
    """Number of records to skip (default 0)."""
    offset: Int = 0
  }

  # ─── Summary types (for use inside relation fields) ───────────────────────────

  type UserSummary {
    firstName: String
    lastName: String
    email: String
  }

  type DepartmentSummary {
    name: String
    code: String
  }

  type WorkflowStepActionSummary {
    name: String
    key: String
  }

  type WorkflowStepSummary {
    name: String
    key: String
    isFinal: Boolean
    isInitial: Boolean
    position: Int
    actions: [WorkflowStepActionSummary]
  }

  type WorkflowSummary {
    name: String
    key: String
    version: Int
    status: String
    steps: [WorkflowStepItemSummary]
  }

  type WorkflowStepItemSummary {
    name: String
    key: String
    position: Int
  }

  # ─── Case ────────────────────────────────────────────────────────────────────

  type Case {
    id: ID!
    caseNumber: String!
    title: String!
    status: String!
    priority: String!
    type: String!
    description: String
    referralStatus: String
    dueDate: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    closedAt: DateTime
    # Relations
    assignee: UserSummary
    currentStep: WorkflowStepSummary
    workflow: WorkflowSummary
    originatingDepartment: DepartmentSummary
    currentDepartment: DepartmentSummary
    creator: UserSummary
  }

  type CaseConnection {
    data: [Case!]!
    pagination: PaginationInfo!
    meta: QueryMeta!
  }

  input CaseFilter {
    status: StringFilterOp
    priority: StringFilterOp
    type: StringFilterOp
    referralStatus: StringFilterOp
    createdAt: DateTimeFilterOp
    updatedAt: DateTimeFilterOp
    dueDate: DateTimeFilterOp
    title: StringContainsOp
    caseNumber: StringSearchOp
  }

  input CaseSort {
    caseNumber: SortDirection
    status: SortDirection
    priority: SortDirection
    createdAt: SortDirection
    updatedAt: SortDirection
    dueDate: SortDirection
  }

  # ─── Workflow ─────────────────────────────────────────────────────────────────

  type Workflow {
    id: ID!
    key: String!
    name: String!
    description: String
    version: Int!
    status: String!
    publishedAt: DateTime
    isActive: Boolean!
    isDefault: Boolean!
    createdAt: DateTime!
    # Relations
    department: DepartmentSummary
    steps: [WorkflowStepItem]
  }

  type WorkflowStepItem {
    name: String
    key: String
    isInitial: Boolean
    isFinal: Boolean
    position: Int
  }

  type WorkflowConnection {
    data: [Workflow!]!
    pagination: PaginationInfo!
    meta: QueryMeta!
  }

  input WorkflowFilter {
    status: StringFilterOp
    key: StringSearchOp
    isActive: BooleanFilter
    version: IntFilter
  }

  input WorkflowSort {
    key: SortDirection
    version: SortDirection
    createdAt: SortDirection
  }

  # ─── WorkflowStep ─────────────────────────────────────────────────────────────

  type WorkflowStep {
    id: ID!
    key: String!
    name: String!
    description: String
    isInitial: Boolean!
    isFinal: Boolean!
    position: Int!
    createdAt: DateTime!
    # Relations
    workflow: WorkflowStepWorkflowSummary
  }

  type WorkflowStepWorkflowSummary {
    name: String
    key: String
    version: Int
  }

  type WorkflowStepConnection {
    data: [WorkflowStep!]!
    pagination: PaginationInfo!
    meta: QueryMeta!
  }

  input WorkflowStepFilter {
    key: StringExactFilter
    isInitial: BooleanFilter
    isFinal: BooleanFilter
  }

  input WorkflowStepSort {
    position: SortDirection
    key: SortDirection
  }

  # ─── Referral ─────────────────────────────────────────────────────────────────

  type Referral {
    id: ID!
    referralReason: String
    notes: String
    status: String!
    referredAt: DateTime!
    acceptedAt: DateTime
    rejectedAt: DateTime
    completedAt: DateTime
    # Relations
    case: ReferralCaseSummary
    fromTenant: TenantSummary
    toTenant: TenantSummary
    referrer: UserSummary
  }

  type ReferralCaseSummary {
    caseNumber: String
    title: String
    status: String
  }

  type TenantSummary {
    name: String
    code: String
  }

  type ReferralConnection {
    data: [Referral!]!
    pagination: PaginationInfo!
    meta: QueryMeta!
  }

  input ReferralFilter {
    status: StringFilterOp
    referredAt: DateTimeFilterOp
  }

  input ReferralSort {
    referredAt: SortDirection
    status: SortDirection
  }

  # ─── Assignment ───────────────────────────────────────────────────────────────

  type Assignment {
    id: ID!
    assignmentType: String
    notes: String
    assignedAt: DateTime!
    unassignedAt: DateTime
    isActive: Boolean!
    # Relations
    case: AssignmentCaseSummary
    assignee: UserSummary
    assigner: UserSummary
  }

  type AssignmentCaseSummary {
    caseNumber: String
    title: String
  }

  type AssignmentConnection {
    data: [Assignment!]!
    pagination: PaginationInfo!
    meta: QueryMeta!
  }

  input AssignmentFilter {
    isActive: BooleanFilter
    assignedAt: DateTimeFilterOp
  }

  input AssignmentSort {
    assignedAt: SortDirection
    isActive: SortDirection
  }

  # ─── AuditLog ─────────────────────────────────────────────────────────────────

  type AuditLog {
    id: ID!
    entityType: String
    entityId: String
    action: String
    ipAddress: String
    userAgent: String
    createdAt: DateTime!
    # Relations
    user: UserSummary
  }

  type AuditLogConnection {
    data: [AuditLog!]!
    pagination: PaginationInfo!
    meta: QueryMeta!
  }

  input AuditLogFilter {
    entityType: StringFilterOp
    action: StringFilterOp
    createdAt: DateTimeFilterOp
    entityId: StringExactFilter
  }

  input AuditLogSort {
    createdAt: SortDirection
    entityType: SortDirection
  }

  # ─── Department ───────────────────────────────────────────────────────────────

  type Department {
    id: ID!
    code: String!
    name: String!
    description: String
    isActive: Boolean!
    createdAt: DateTime!
  }

  type DepartmentConnection {
    data: [Department!]!
    pagination: PaginationInfo!
    meta: QueryMeta!
  }

  input DepartmentFilter {
    code: StringSearchOp
    name: StringContainsOp
    isActive: BooleanFilter
  }

  input DepartmentSort {
    code: SortDirection
    name: SortDirection
    createdAt: SortDirection
  }

  # ─── Metrics (virtual entity) ─────────────────────────────────────────────────

  enum MetricField {
    totalCases
    openCases
    closedCases
    avgResolutionDays
    overdueCount
  }

  type Metrics {
    totalCases: Int
    openCases: Int
    closedCases: Int
    avgResolutionDays: Float
    overdueCount: Int
    meta: QueryMeta!
  }

  # ─── Filter Input Primitives ──────────────────────────────────────────────────

  """Equality / in-list / not-equal filter for string enum columns."""
  input StringFilterOp {
    eq: String
    neq: String
    in: [String!]
  }

  """Case-insensitive contains filter (maps to Prisma 'contains')."""
  input StringContainsOp {
    contains: String
  }

  """Supports both exact match and contains."""
  input StringSearchOp {
    eq: String
    contains: String
  }

  """Exact match filter for string fields."""
  input StringExactFilter {
    eq: String
  }

  """Range filter for DateTime columns."""
  input DateTimeFilterOp {
    gte: DateTime
    lte: DateTime
    gt: DateTime
    lt: DateTime
  }

  """Boolean equality filter."""
  input BooleanFilter {
    eq: Boolean
  }

  """Exact match for integer fields."""
  input IntFilter {
    eq: Int
  }

  enum SortDirection {
    asc
    desc
  }

  # ─── Mutation Input / Payload Types ──────────────────────────────────────────

  ## createCase
  input CreateCaseInput {
    workflowKey: String!
    title: String!
    description: String
    type: String!
    priority: CasePriority = normal
    data: JSON
  }

  type CreateCasePayload {
    caseId: ID!
    caseNumber: String!
    status: String!
    currentStep: String!
    createdAt: DateTime!
  }

  ## updateCase
  input UpdateCaseInput {
    caseId: ID!
    title: String
    description: String
    priority: CasePriority
    type: String
    dueDate: DateTime
    data: JSON
  }

  type UpdateCasePayload {
    caseId: ID!
    caseNumber: String!
    updatedFields: [String!]!
    updatedAt: DateTime!
  }

  ## closeCase
  input CloseCaseInput {
    caseId: ID!
    reason: String
    resolution: String
  }

  type CloseCasePayload {
    caseId: ID!
    caseNumber: String!
    closedAt: DateTime!
  }

  ## executeTransition
  input ExecuteTransitionInput {
    caseId: ID!
    transitionId: ID!
    comment: String
  }

  type ExecuteTransitionPayload {
    caseId: ID!
    caseNumber: String!
    previousStep: String
    currentStep: String!
    status: String!
    transitionedAt: DateTime!
  }

  ## createReferral
  input CreateReferralInput {
    caseId: ID!
    toTenantCode: String!
    referralReason: String!
    notes: String
  }

  type CreateReferralPayload {
    referralId: ID!
    caseId: ID!
    caseNumber: String!
    toTenant: String!
    status: String!
    referredAt: DateTime!
  }

  ## inviteUser
  input InviteUserInput {
    email: String!
    firstName: String!
    lastName: String!
    phone: String
    departmentCode: String
    roleId: ID
  }

  type InviteUserPayload {
    userId: ID!
    email: String!
    firstName: String!
    lastName: String!
    username: String!
    tenantId: ID!
    mustChangePassword: Boolean!
    createdAt: DateTime!
    note: String
  }

  ## updateUser
  input UpdateUserInput {
    userId: ID!
    firstName: String
    lastName: String
    phone: String
    departmentCode: String
  }

  type UpdateUserPayload {
    userId: ID!
    email: String!
    updatedFields: [String!]!
    updatedAt: DateTime!
  }

  ## deactivateUser
  input DeactivateUserInput {
    userId: ID!
    reason: String
  }

  type DeactivateUserPayload {
    userId: ID!
    email: String!
    deactivatedAt: DateTime!
  }

  # ─── Scalars & Enums ──────────────────────────────────────────────────────────

  enum CasePriority {
    low
    normal
    high
    critical
  }

  """Arbitrary JSON object."""
  scalar JSON

  # ─── Root Types ───────────────────────────────────────────────────────────────

  type Query {
    """List cases. Requires scope: cases:read"""
    cases(filter: CaseFilter, sort: CaseSort, pagination: Pagination): CaseConnection!
      @requireScope(scope: "cases:read")

    """List workflows. Requires scope: workflows:read"""
    workflows(filter: WorkflowFilter, sort: WorkflowSort, pagination: Pagination): WorkflowConnection!
      @requireScope(scope: "workflows:read")

    """List workflow steps. Requires scope: workflowSteps:read"""
    workflowSteps(filter: WorkflowStepFilter, sort: WorkflowStepSort, pagination: Pagination): WorkflowStepConnection!
      @requireScope(scope: "workflowSteps:read")

    """List referrals. Requires scope: referrals:read"""
    referrals(filter: ReferralFilter, sort: ReferralSort, pagination: Pagination): ReferralConnection!
      @requireScope(scope: "referrals:read")

    """List assignments. Requires scope: assignments:read"""
    assignments(filter: AssignmentFilter, sort: AssignmentSort, pagination: Pagination): AssignmentConnection!
      @requireScope(scope: "assignments:read")

    """List audit logs. Requires scope: auditLogs:read"""
    auditLogs(filter: AuditLogFilter, sort: AuditLogSort, pagination: Pagination): AuditLogConnection!
      @requireScope(scope: "auditLogs:read")

    """List departments. Requires scope: departments:read"""
    departments(filter: DepartmentFilter, sort: DepartmentSort, pagination: Pagination): DepartmentConnection!
      @requireScope(scope: "departments:read")

    """Get aggregate metrics. Requires scope: metrics:read"""
    metrics(select: [MetricField!]): Metrics!
      @requireScope(scope: "metrics:read")
  }

  type Mutation {
    """Create a new case. Requires scope: cases:create"""
    createCase(input: CreateCaseInput!): CreateCasePayload!
      @requireScope(scope: "cases:create")

    """Update a case. Requires scope: cases:update"""
    updateCase(input: UpdateCaseInput!): UpdateCasePayload!
      @requireScope(scope: "cases:update")

    """Close a case. Requires scope: cases:update"""
    closeCase(input: CloseCaseInput!): CloseCasePayload!
      @requireScope(scope: "cases:update")

    """Execute a workflow transition. Requires scope: cases:update"""
    executeTransition(input: ExecuteTransitionInput!): ExecuteTransitionPayload!
      @requireScope(scope: "cases:update")

    """Create a referral. Requires scope: referrals:create"""
    createReferral(input: CreateReferralInput!): CreateReferralPayload!
      @requireScope(scope: "referrals:create")

    """Invite a user to your tenant. Requires scope: users:create"""
    inviteUser(input: InviteUserInput!): InviteUserPayload!
      @requireScope(scope: "users:create")

    """Update a user. Requires scope: users:update"""
    updateUser(input: UpdateUserInput!): UpdateUserPayload!
      @requireScope(scope: "users:update")

    """Deactivate a user. Requires scope: users:deactivate"""
    deactivateUser(input: DeactivateUserInput!): DeactivateUserPayload!
      @requireScope(scope: "users:deactivate")
  }
`;
