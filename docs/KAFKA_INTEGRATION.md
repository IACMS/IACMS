# Kafka Integration

## Overview

IACMS uses Apache Kafka as the event streaming backbone for all inter-service communication.  
Kafka replaced Redis Pub/Sub to provide **guaranteed delivery** and **message persistence**.

---

## Why Kafka Over Redis Pub/Sub

| Feature | Redis Pub/Sub (Before) | Kafka (Now) |
|---------|----------------------|-------------|
| Message persistence | No - lost if consumer is down | Yes - stored on disk |
| Replay missed events | Impossible | Built-in |
| Guaranteed delivery | No | Yes |
| Consumer groups | No | Yes - distribute load |
| Ordering | No | Per-partition ordering |

---

## Infrastructure

| Container | Port | Purpose |
|-----------|------|---------|
| `iacms-zookeeper` | 2181 | Kafka cluster management |
| `iacms-kafka` | 9092 | Message broker (host access) |
| `iacms-kafka` | 29092 | Message broker (internal Docker network) |

### Start Kafka

```powershell
cd infrastructure
docker-compose up -d zookeeper kafka

# Or start everything
npm run docker:up
```

### Verify Kafka is Running

```powershell
docker ps --filter "name=iacms-kafka"
docker exec iacms-kafka kafka-topics --bootstrap-server localhost:9092 --list
```

---

## Kafka Topics

Each event type has its own dedicated topic:

| Topic | Publisher | Subscribers | Description |
|-------|-----------|-------------|-------------|
| `user.created` | auth-service | notification-service | New user registered |
| `user.updated` | auth-service | - | User profile updated |
| `case.created` | case-service | notification-service, audit-service | New case opened |
| `case.updated` | case-service | audit-service | Case details changed |
| `case.assigned` | case-service | notification-service, audit-service | Case assigned to worker |
| `case.transitioned` | case-service | notification-service | Case executed a workflow transition |
| `workflow.created` | workflow-service | audit-service | New workflow created |
| `workflow.updated` | workflow-service | audit-service | Workflow modified |
| `workflow.published` | workflow-service | — | Workflow version published |
| `workflow.archived` | workflow-service | — | Workflow version archived |
| `referral.created` | referral-service | notification-service, audit-service | New referral submitted |
| `referral.completed` | referral-service | notification-service | Referral completed (case handoff) |
| `referral.accepted` | referral-service | notification-service | Referral accepted |
| `referral.rejected` | referral-service | notification-service | Referral rejected |
| `integration.created` | integration-service | audit-service | External integration configured |
| `integration.updated` | integration-service | audit-service | Integration settings changed |
| `integration.sync` | integration-service | - | Manual sync triggered |
| `webhook.created` | integration-service | audit-service | Webhook endpoint added |
| `webhook.updated` | integration-service | audit-service | Webhook endpoint modified |
| `webhook.test` | integration-service | - | Webhook test triggered |
| `audit.log` | any service | audit-service | Generic audit log entry |

---

## EventBus API

The `EventBus` class in `shared/utils/eventBus.js` is the single interface all services use.

### Constructor

```javascript
import EventBus from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(
  process.env.KAFKA_BROKERS || 'localhost:9092',  // Kafka broker address(es)
  'my-service'                                     // Service name (used as consumer group ID)
);
```

### Publishing an Event

```javascript
// Publish event - non-blocking, won't crash the service if Kafka is down
await eventBus.publish('case.created', {
  caseId: case_.id,
  tenantId: case_.tenantId,
});
```

### Subscribing to Events

```javascript
// Subscribe - consumer group ensures only one instance processes each message
await eventBus.subscribe('case.created', (data) => {
  console.log('New case:', data.caseId);
});
```

### Shutdown

```javascript
// Gracefully disconnect (call on process exit)
await eventBus.close();
```

### Available Topic Constants

```javascript
import EventBus, { TOPICS } from '../../../shared/utils/eventBus.js';

await eventBus.publish(TOPICS.CASE_CREATED, { caseId: '...' });
await eventBus.subscribe(TOPICS.CASE_ASSIGNED, handler);
```

---

## Environment Variables

| Variable | Development | Docker (Internal) |
|----------|------------|-------------------|
| `KAFKA_BROKERS` | `localhost:9092` | `kafka:29092` |

---

## Consumer Groups

Each service has its own consumer group (named after the service).  
This ensures:
- If you run multiple instances of a service, only **one** processes each message
- Each service gets **its own copy** of the message independently

```
case.created topic
    │
    ├── notification-service (group)  → One instance processes it
    └── audit-service (group)         → Another instance processes it
```

---

## Message Format

Every message published to Kafka has this structure:

```json
{
  "type": "case.created",
  "data": {
    "caseId": "uuid",
    "tenantId": "uuid"
  },
  "timestamp": "2026-02-17T10:00:00.000Z",
  "serviceId": "case-service"
}
```

The `data` field is what your subscriber handler receives.

---

## Monitoring Topics via CLI

```bash
# List all topics
docker exec iacms-kafka kafka-topics --bootstrap-server localhost:9092 --list

# View messages in a topic (from beginning)
docker exec iacms-kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic case.created \
  --from-beginning

# Describe a topic (partitions, replication)
docker exec iacms-kafka kafka-topics \
  --bootstrap-server localhost:9092 \
  --describe \
  --topic case.created
```

---

## Fault Tolerance

- **Service down:** Messages accumulate in Kafka. When the service restarts, it picks up from where it left off.
- **Kafka down:** Services continue to work - `publish()` fails silently with a warning log. No crash.
- **Message replay:** `fromBeginning: false` in subscriber means only new messages after startup are processed.
