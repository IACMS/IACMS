# Contract: Kafka `audit.log`

Topic: `audit.log` (`TOPICS.AUDIT_LOG`)

Required fields validated by audit-service (`audit-event.schema.json`):

- `tenantId` — agency that owns the audit row classification  
- `entityType`, `entityId`, `action`  
- Optional: `userId`, `relatedTenantId` (cross-agency visibility; both nullable — schema uses `anyOf` so `null` is valid JSON alongside UUID strings), `oldValues`, `newValues`, `metadata`, `ipAddress`, `userAgent`

Malformed events MUST be discarded with warning log (never crash the consumer loop).
