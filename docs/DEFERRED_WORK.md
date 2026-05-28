# Deferred roadmap follow-ups

This repo is intentionally **early-stage (greenfield)**. Do **not** preserve backward compatibility unless an external dependency strictly requires it.

**Roadmap vs reality:** see **[`PHASE_STATUS.md`](PHASE_STATUS.md)** (Done / Partial / Not started vs [`PHASES.md`](../PHASES.md)).

---

## Phase 7 — Audit producer completeness

- **Delivered:** Auth, **case**, **workflow** (definitions + draft step/transition CRUD), **referral**, and **audit-consumer** wiring; payloads use structured `oldValues` / `newValues` where applicable; cross-tenant cases/referrals set `relatedTenantId` when meaningful. Audit-service rejects invalid envelopes with **Ajv** (+ tests in `services/audit-service/tests/`).
- **Optional follow-ups:** Instrument **integration-service** or other Kafka producers when they mutate tenant data.

---

## Phase 8 — Tenant isolation

- **Decision:** [**Explicit application-layer tenancy** — captured in **`docs/TENANT_ISOLATION.md`**](TENANT_ISOLATION.md). Postgres RLS deferred until pooling + strict per-request transactions are designed.
- **Code:** [`shared/middleware/tenantContext.js`](../shared/middleware/tenantContext.js) sets **`req.iacmsTenantId`** from **`x-tenant-id`** when present (optional to mount).

---

## Phase 9 — API collections & Kafka catalogue

- **Postman:** [`IACMS_Auth_Postman_Collection.json`](../IACMS_Auth_Postman_Collection.json) (auth) + [`IACMS_Platform_API.postman_collection.json`](../IACMS_Platform_API.postman_collection.json) (gateway: workflows, cases, referrals, audit). Fill `tenantId`, tokens, and entity UUIDs before running folders.
- **Kafka tables:** Prefer [`shared/utils/eventBus.js`](../shared/utils/eventBus.js) `TOPICS` as source of truth; [`KAFKA_INTEGRATION.md`](KAFKA_INTEGRATION.md) mirrors them.

---

## Operations / quality (cross-phase)

- **Redis (workflow-service):** `REDIS_URL` enables read-through caching of `/workflows/:id/full` for **PUBLISHED** rows; misses fall back to Postgres. Fail-open if Redis absent (cold DB reads).
- **Tests:** Extend integration/E2E (gateway RBAC envelope, malformed audit ingestion under load).

---

## Recently closed (was deferred)

| Item | Resolution |
|------|------------|
| Deprecated Kafka topic `workflow.state.changed` | Removed; see `TOPICS.CASE_TRANSITIONED`. |
| Duplicate Kafka clients inside workflow-service | Centralized in [`services/workflow-service/src/config/eventBus.js`](../services/workflow-service/src/config/eventBus.js). |

When you finish another deferred item, move it here — keep short.
