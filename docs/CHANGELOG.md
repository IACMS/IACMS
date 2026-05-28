# IACMS changelog

## Unreleased

- **Phase 7:** Auth + case + workflow (including draft **step/transition** CRUD) + referral **`audit.log`** producers use structured `oldValues` / `newValues` and **`relatedTenantId`** for cross-tenant visibility; audit-service uses **Ajv** + unit tests in `services/audit-service/tests/`; workflow-service shares one Kafka client (`services/workflow-service/src/config/eventBus.js`).
- **Phase 8:** Tenant isolation ADR ([`TENANT_ISOLATION.md`](TENANT_ISOLATION.md)); optional `tenantContextMiddleware` sets [`req.iacmsTenantId`](../shared/middleware/tenantContext.js).
- **Phase 9:** Gateway Postman bundle [`IACMS_Platform_API.postman_collection.json`](../IACMS_Platform_API.postman_collection.json) (workflows, cases, referrals, audit).
- Implemented PHASES Sprint 0 `multi_tenant_workflow_engine` migration (workflow steps/transitions, case history, case sequences, audit `related_tenant_id`, referral partial unique index) and frozen contracts under `shared/contracts/`.
- Gateway forwards `x-user-roles`; RBAC response includes explicit `roleIds`; workflow service publishes `WORKFLOW_*` topics and caches published definitions in Redis (`workflow.cache.js`).
- Case service binds creation to published workflows (`workflowKey`), generates tenant-scoped case numbers, enforces referral-aware tenant reads/writes, exposes transition execution + `/cases/:id/state`.
- Referrals drive `Case.currentTenantId`/`referralStatus`; Kafka payloads include `TOPICS.REFERRAL_COMPLETED`.
- Audit service validates inbound audit events and adds cross-tenant trails plus CSV compliance export.
