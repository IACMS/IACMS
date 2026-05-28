# Contract: Kafka `case.transitioned`

Topic: `case.transitioned` (`TOPICS.CASE_TRANSITIONED`)

Canonical payload keys:

| Field | Type | Notes |
|-------|------|-------|
| `caseId` | uuid | |
| `tenantId` | uuid | Acting tenant snapshot |
| `workflowId` | uuid | |
| `workflowVersion` | int | Frozen at execution |
| `transitionId` | uuid | Workflow transition row |
| `fromStepId` | uuid `\\| null` | null on create |
| `toStepId` | uuid | |
| `actorId` | uuid | User performing transition |
| `comment` | string `\\| null` | |
| `caseNumber` | string | Stable human id |
| `occurredAt` | ISO8601 | Event time |

Replaces informal `workflow.state.changed` topic for orchestration-aware consumers.
