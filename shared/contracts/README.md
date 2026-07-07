# IACMS API and event contracts

Cross-service fixtures and schema documents referenced by PHASES.md Sprint 0.

| Artifact | Purpose |
|----------|---------|
| [workflow-full.contract.md](./workflow-full.contract.md) | Response shape for `GET /workflows/:id/full` |
| [__fixtures__/workflow-full.example.json](./__fixtures__/workflow-full.example.json) | Canonical example for workflow + case service tests |
| [audit-event.contract.md](./audit-event.contract.md) | Kafka `audit.log` payload semantics |
| [audit-event.schema.json](./audit-event.schema.json) | JSON Schema validated by audit-service consumer |
| [case-transitioned.contract.md](./case-transitioned.contract.md) | Kafka `case.transitioned` canonical payload |
| [referral-events.contract.md](./referral-events.contract.md) | Kafka `referral.*` payloads |
| [__fixtures__/referral.example.json](./__fixtures__/referral.example.json) | Minimal referral envelope example |

Do not mutate fixture fields without updating consumers and PHASES appendix references.

Current contract set includes department-aware extensions for:
- workflow scope via `departmentId`
- referral routing via `fromDepartmentId` and `toDepartmentId`
