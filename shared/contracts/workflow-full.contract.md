# Contract: workflow full projection

Producer: workflow-service (`GET /workflows/:id/full`)

Consumers: case-service workflow client, gateway (optional caching).

Shape (canonical JSON):

- `id` (uuid): workflow row id  
- `tenantId` (uuid)  
- `key` (string): stable workflow key (`tenantId` + `key` identifies a lineage)  
- `version` (int): immutable published revision number  
- `status`: `DRAFT` | `PUBLISHED` | `ARCHIVED`  
- `publishedAt`: ISO8601 string or null when not published  
- `steps`: array of `{ id, key, name, description|null, isInitial, isFinal, position, allowedRoleIds[] }`  
- `transitions`: array of `{ id, name, description|null, fromStepId, toStepId, allowedRoleIds[], requiresComment }`

Ordering: steps sorted ascending by `position` then `key`. Transitions sorted by `fromStepId` then `name`.
