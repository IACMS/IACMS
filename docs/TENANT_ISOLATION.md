# Tenant isolation (ADR)

**Status:** Accepted for the current greenfield stack (2026).  
**Decision:** Enforce multi-tenancy in **application code** with explicit Prisma `where` clauses (`tenantId`, `currentTenantId`, and referral-aware helpers such as `readableCaseConditions` / `writableCaseWhere`). **PostgreSQL RLS is deferred.**

## Rationale

- **Prisma + server-side connection pools** do not give a safe, per-request DB session default. `SET LOCAL app.current_tenant_id` only holds for the lifetime of one transaction/socket; multiplexed pools reuse connections across tenants unless every query is wrapped consistently.
- The API Gateway remains the trusted source for **`x-tenant-id`** (and **`x-user-id`** / **`x-user-roles`**) after authentication. Downstream services must treat these headers as authoritative and scope every tenant-owned read/write.

## Non-goals (for now)

- Row-level policies on `cases`, `workflows`, `audit_logs`, etc.
- Transparent “RLS middleware” around Prisma without a dedicated tenancy-per-connection strategy (e.g. PgBouncer transaction pooling + strict transaction wrapping).

## Implementation hooks

- [`shared/middleware/tenantContext.js`](../shared/middleware/tenantContext.js) parses `x-tenant-id` into **`req.iacmsTenantId`** when present so handlers may use a single accessor (optional).
- Prefer existing domain helpers (**case** referral scope, **workflow** `where: { tenantId }`) over scattering raw header reads.

## Future reconsideration triggers

Migrate to **RLS + `SET LOCAL`** only if:

1. Threat model demands DB-enforced isolation against defective application code; and  
2. Operations can dedicate **tenant-scoped transactions** (or pooling mode) such that setting `app.current_tenant_id` cannot leak across concurrent requests.

When RLS lands, revise this ADR with policy tables and rollout steps.
