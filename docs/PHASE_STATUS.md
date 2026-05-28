# Implementation status vs `PHASES.md`

This file is the **single place** to see what the repo has actually shipped relative to the roadmap in [`PHASES.md`](../PHASES.md). It is updated when major slices land; fine-grained backlog lives in [`DEFERRED_WORK.md`](DEFERRED_WORK.md).

| PHASES.md section | Status | What shipped (short) |
|-------------------|--------|----------------------|
| **§2 Phase 0 — Foundation** | **Done** | Auth, gateway, RBAC, Kafka, microservices skeleton, audit consumer baseline. |
| **§3.1 Sprint 0 — Schema & contracts** | **Done** | Root Prisma migration direction, `shared/contracts/`, `TOPICS`, shared error classes, gateway **`x-user-roles`**, seed + contract-style tests. |
| **§5 Phase 1 — Workflow definition API** | **Done** | Steps/transitions CRUD, invariants/publish, `GET /workflows/:id/full`, `GET /workflows/published`. |
| **§6 Phase 2 — Case + workflow binding** | **Done** | Case create bound to **published** workflow + `workflowKey`, tenant-scoped case numbers, referral-aware read/write scope. |
| **§7 Phase 3 — Execution engine** | **Done** | `POST /cases/:id/transitions/:transitionId/execute`, `CaseHistory`, `CASE_TRANSITIONED` + audit payloads. |
| **§8 Phase 4 — Transition RBAC** | **Done** | Engine checks `transition.allowedRoleIds` vs gateway-forwarded **`x-user-roles`**; RBAC route map extended for new paths. |
| **§9 Phase 5 — `/cases/:id/state`** | **Done** | State + available transitions/history-style projection for the acting tenant. |
| **§9b Phase 5b — Referrals** | **Done** | Referral lifecycle + case `currentTenantId` / `referralStatus`; Kafka `TOPICS` + structured `audit.log` with **`relatedTenantId`** where needed. |
| **§10 Phase 6 — Versioning + cache** | **Done** | New version fork, publish/archive, Redis read-through cache for published workflow **full** JSON. |
| **§11 Phase 7 — Audit hardening** | **Mostly done** | Ajv validation on `audit.log`, trails + compliance export; rich producers on **auth, case, workflow (incl. draft step/transition), referral**. Optional: other services (e.g. integration) if they emit audit events later. |
| **§12 Phase 8 — Perf + tenant isolation** | **Partial** | **How:** Explicit Prisma `where` tenancy + [`TENANT_ISOLATION.md`](TENANT_ISOLATION.md) ADR; optional [`tenantContext`](../shared/middleware/tenantContext.js) sets `req.iacmsTenantId`. **Not in scope yet:** Postgres RLS, full index/k6 perf pass per PHASES §12. |
| **§13 Phase 9 — Docs & cleanup** | **Partial** | `CHANGELOG`, platform Postman ([`IACMS_Platform_API.postman_collection.json`](../IACMS_Platform_API.postman_collection.json)), README/DEFERRED/Kafka tables. **Still thin vs PHASES:** full narrative rewrites inside `DOCUMENTATION.md` for every area, legacy file cleanups named in PHASES. |
| **§14 Future / deferred** | **Not started** | WebSocket inbox, SMS/push, workflow UI designer, `Case.data` JSON Schema, audit hash chain, etc. |

### Legend

- **Done** — Main acceptance for that phase is satisfied in code paths that matter for demos and integration.
- **Mostly done** — Core behavior is there; remaining items are narrow (extra producers, extra tests, or doc polish).
- **Partial** — Intentional trade-off (e.g. RLS deferred) or documentation/ops not fully brought up to PHASES wording.
- **Not started** — Explicitly out of current scope per PHASES “Future”.

When a row moves from **Partial** → **Done**, update this table and add a line to [`CHANGELOG.md`](CHANGELOG.md).
