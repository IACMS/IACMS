# IACMS — Inter-Agency Case Management System
## Comprehensive Platform Documentation

> **Version**: 2.0 — Post-Microservices Restructure  
> **Last Updated**: November 2026  
> **Status**: Active Development

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Use Cases & Target Users](#2-use-cases--target-users)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Technology Stack & Engineering Decisions](#4-technology-stack--engineering-decisions)
5. [Service Catalog](#5-service-catalog)
6. [Cross-Cutting Concerns](#6-cross-cutting-concerns)
7. [Database Schema](#7-database-schema)
8. [Partner & Integration APIs](#8-partner--integration-apis)
9. [Infrastructure & Deployment](#9-infrastructure--deployment)
10. [Shared Library](#10-shared-library)
11. [API Reference](#11-api-reference)
12. [Development Guide](#12-development-guide)
13. [Operational Runbook](#13-operational-runbook)

---

## 1. Platform Overview

IACMS (Inter-Agency Case Management System) is a **multi-tenant, microservices-based backend platform** designed to help government organizations manage cases across agency boundaries. It provides a unified data model, workflow engine, cross-agency referral system, and audit compliance infrastructure — all exposed through a single, secured API gateway.

### Core Value Proposition

| Problem | IACMS Solution |
|---------|---------------|
| Cases siloed in individual agencies with no shared visibility | Multi-tenant model with cross-agency referral system |
| No standardized workflow for case progression | Per-tenant, versioned workflow engine with configurable steps and transitions |
| No audit trail for compliance | Immutable audit log with Kafka-driven persistence + CSV compliance export |
| Partner agencies need programmatic access | GraphQL partner API with scope-based API keys |
| File handling is ad-hoc and insecure | Dedicated file service with virus scanning, chunked uploads, and lifecycle management |
| No real-time communication between caseworkers | Built-in chat service with WebSocket presence and message history |

---

## 2. Use Cases & Target Users

### Primary User Roles

| Role | Description | Key Capabilities |
|------|-------------|-----------------|
| `system_admin` | Platform-level super-admin | Manages all tenants, approves agency registrations, platform settings |
| `tenant_admin` | Organization administrator | Manages users, roles, departments, workflows within their agency |
| `case_manager` | Senior caseworker | Creates and closes cases, assigns work, approves referrals |
| `case_worker` | Front-line staff | Processes assigned cases, executes workflow transitions |
| `auditor` | Compliance officer | Read-only access to audit trails and compliance exports |
| `partner_api` | External system/integration | Scope-restricted GraphQL access via API key |

### Scenarios

**Scenario 1 — Intra-Agency Case Management**  
A municipal social services agency creates cases for citizen inquiries. Each case follows a configurable workflow (e.g., *Intake → Assessment → Resolution → Closed*). Caseworkers execute transitions, upload supporting documents, and track progression through the dashboard.

**Scenario 2 — Cross-Agency Referral**  
A public health agency receives a case that requires law enforcement involvement. A case manager creates a referral to the police tenant. The target agency accepts (or rejects) the referral, takes ownership of the case at their workflow step, and notifies the originating agency upon completion.

**Scenario 3 — Partner Integration**  
A third-party civic-tech platform needs to read case statuses for reporting. A tenant admin creates an API key with `cases:read` scope. The partner system queries the GraphQL endpoint using the `X-API-Key` header and receives webhook callbacks when cases change status.

**Scenario 4 — Compliance Audit**  
A government auditor needs to produce a compliance report. They query the audit trail for a specific tenant and time window, filtering by entity type and action. The system returns a structured log of all mutations with actor IDs, old/new values, and IP addresses, exportable as CSV.

---

## 3. High-Level Architecture

```
             +--------------------------------------------------+
             |                    CLIENTS                       |
             |  Web Browser  |  Mobile API  |  Partner System   |
             +-------+--------+------+-------+------+-----------+
                     | Session       | JWT Bearer   | X-API-Key
                     +---------------+--------------+
                                     |
             +--------------------------------------------------+
             |          API Gateway (Port 3000)                 |
             |  . Session + JWT + API Key authentication        |
             |  . RBAC enforcement (Redis-cached permissions)   |
             |  . Rate limiting (100 req/min, 10 auth/min)      |
             |  . Reverse proxy (http-proxy-middleware)         |
             |  . GraphQL partner API (Apollo Server 5)        |
             |  . WebSocket upgrade proxy to Chat Service       |
             |  . Outbox publisher + Webhook dispatcher workers |
             +--------------------------------------------------+
                               | x-internal-service-token
       +----------+----------+-+----------+------------------+
       |          |          |           |                  |
  +----+---+  +---+----+  +--+-----+  +-+------+  +--------+-+
  |  IAM   |  | Case   |  |  File  |  |  Chat  |  |  Audit  |
  |Service |  |Engine  |  |Service |  |Service |  | Service |
  | :3001  |  | :3003  |  | :3009  |  | :3010  |  |  :3006  |
  +--------+  +--------+  +--------+  +--------+  +---------+
       |          |
  +----+------+  +---------+
  |Notification|  |Integration|
  |  Service  |  |  Service  |
  |   :3008   |  |   :3007   |
  +-----------+  +-----------+

  +------------+  +----------+  +------------+
  | PostgreSQL |  |  Kafka   |  |   Redis    |
  |  :5434     |  |  :9092   |  |   :6379    |
  | (Prisma)   |  | (KRaft)  |  | Sessions + |
  +------------+  +----------+  | RBAC Cache |
                                +------------+
  +------------+  +----------+
  |   MinIO    |  |  ClamAV  |
  |:9000/9001  |  | (sidecar)|
  | (S3-compat)|  |   :3310  |
  +------------+  +----------+
```

### Design Principles

1. **Gateway-first**: All external traffic enters through the API Gateway. Internal microservices are not publicly reachable in production.
2. **Tenant isolation**: Every database row carries a `tenant_id`. Services enforce tenant scope on every query; cross-tenant data access only happens through explicit referral mechanisms.
3. **Event-driven, not synchronous mesh**: Services communicate through Kafka topics, not inter-service HTTP chains. This decouples services and makes the system resilient to partial failures.
4. **Shared nothing (mostly)**: Services use a shared PostgreSQL database with a single Prisma schema, but each service generates its own Prisma client with only the models it needs. This is a pragmatic tradeoff avoiding polyglot storage complexity.
5. **Fail-open on Kafka**: If Kafka is unavailable, services start and handle HTTP requests normally. Kafka consumers retry with exponential backoff. Notifications may be delayed but the core system stays operational.

---

## 4. Technology Stack & Engineering Decisions

### Core Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Runtime | Node.js | 20+ | LTS, excellent async I/O, large ecosystem |
| Web Framework | Express.js | 5.x | Mature, minimal, widely understood |
| Database | PostgreSQL | 15 | ACID guarantees critical for case integrity |
| ORM | Prisma | 6.x | Type-safe queries, schema-driven migrations, per-service client generation |
| Message Broker | Apache Kafka | 7.5.x (KRaft) | Persistent event log, consumer group replay, durable notifications |
| Session Store | Redis | 7 | Fast, TTL-native, connect-redis integration |
| Object Storage | MinIO | 2025 | S3-compatible, self-hosted, swap to AWS S3 in production |
| Containerization | Docker + Compose | v2 | Reproducible environments, easy local dev |
| GraphQL | Apollo Server | 5.x | Partner API with depth/cost limiting, scope directives |
| API Key Auth | SHA-256 + prefix | — | Secrets stored as one-way hashes; only prefix stored for lookup UX |
| Virus Scanning | ClamAV | stable | Open-source, runs as a sidecar Docker container |

### Key Engineering Decisions

#### Decision 1: Single PostgreSQL database, per-service Prisma clients

**Alternatives considered**: Separate database per service (true microservices isolation).

**Why not**: Government-scale deployments do not require the operational complexity of polyglot storage — separate backup strategies, cross-service joins via HTTP, and eventual consistency issues for audit data. The Prisma schema is the authoritative source of truth; each service generates its own client containing only the models it touches.

**Trade-off**: Harder to independently scale storage; database migrations require coordination. Accepted because the deployment target is a single-region government datacenter.

#### Decision 2: Kafka over Redis Pub/Sub for event streaming

- Messages are **persisted** — not lost if a service is down at publish time
- Consumers can **replay missed events** from the beginning of a topic
- **Consumer groups** give each service its own independent offset
- Each event type has its own topic for isolation and monitoring

**KRaft mode**: Zookeeper removed in favour of Kafka native KRaft consensus, reducing infrastructure from 4+ containers to 1 for local development.

#### Decision 3: Triple authentication at the gateway

Three auth strategies in priority order:
1. **Session (Cookie)** — web browsers. Stored in Redis (`iacms:sess:*`). WebSocket connections get a synthesized short-lived JWT from the session cookie.
2. **JWT Bearer** — API clients and mobile apps. Access tokens expire in 24h; refresh tokens in 7 days.
3. **API Key (`X-API-Key`)** — partner integrations. Prefixed `iacms_live_`, stored as SHA-256 hashes with scope arrays.

**Why all three?** Browser clients need cookies for CSRF protection. API clients need stateless JWT. Partner integrations need persistent, revocable keys.

#### Decision 4: Outbox Pattern for reliable audit/webhook delivery

All partner API GraphQL mutations write to an `AuditOutbox` table in the same database transaction. A background poller publishes these records to Kafka, and a second poller dispatches matching webhook payloads to tenant webhook URLs.

**Why**: Eliminates the dual-write problem. Without the outbox, a crash between writing the case row and publishing the Kafka event would silently lose the event permanently.

#### Decision 5: RBAC cache in Redis with 5-minute TTL

Every RBAC permission check fetches from Redis first (`rbac:perms:{userId}:{tenantId}`). Cache miss triggers a live fetch from IAM service, written back with 5-minute TTL.

**Trade-off**: Role changes take up to 5 minutes to propagate. Acceptable for a government case management system where role changes are infrequent. Cache is immediately invalidated on password change and role assignment.

#### Decision 6: Shared `requireInternalRequest` guard

All internal services refuse requests lacking the `x-internal-service-token` header. Required in production; passes through in development for direct service debugging.

#### Decision 7: File service uses Domain-Driven Design layout

Unlike other services (flat MVC), the File Service uses a layered DDD approach: `domain/`, `application/services/`, `infrastructure/`. This is because it has significantly more complexity and technology seams (storage, virus scanner, compression, thumbnails, Redis, Kafka, MinIO) than any other service.

---

## 5. Service Catalog

### 5.1 API Gateway

**Port**: 3000 | **Container**: `iacms-api-gateway`

The single entry point for all external traffic. **The only service with a publicly exposed port in production.**

#### Responsibilities

| Function | Implementation |
|----------|---------------|
| Session authentication | `express-session` + `connect-redis`, cookie `iacms.sid` |
| JWT authentication | `jsonwebtoken` verify against `JWT_SECRET` |
| API Key authentication | SHA-256 lookup against `api_keys` table |
| RBAC enforcement | Per-route permission map + Redis-cached user permissions |
| Reverse proxying | `http-proxy-middleware` with configurable timeout |
| WebSocket proxying | Native `http.Server` upgrade event forwarded to Chat Service |
| Rate limiting | `express-rate-limit` — 100 req/min general, 10 req/min auth |
| GraphQL partner API | Apollo Server 5 mounted at `/api/v1/graphql` |
| Outbox publishing | Background worker: polls `AuditOutbox`, publishes to Kafka every 5s |
| Webhook dispatch | Background worker: polls `AuditOutbox`, delivers signed HTTP POSTs |
| Service health probes | `GET /api/v1/platform/service-probes` pings all downstream `/health` |
| OpenAPI docs | Swagger UI at `/api-docs` |

#### Authentication Flow

```
Request arrives at /api/v1/*
    |
    +-- Is it a PUBLIC_ROUTE? (login, register, etc.) --> pass through
    |
    +-- Has valid iacms.sid session cookie?
    |   --> Load session user -> reconcile mustChangePassword -> set headers -> next()
    |
    +-- Has Authorization: Bearer <jwt>?
    |   --> Verify JWT -> reconcile mustChangePassword -> set headers -> next()
    |
    +-- Has X-API-Key: iacms_live_*?
    |   --> SHA-256 hash -> DB lookup -> populate req.apiKeyContext -> next()
    |
    --> 401 UNAUTHORIZED
```

#### WebSocket Authentication

When a WebSocket client connects to `/ws`, the gateway intercepts the HTTP Upgrade event. If the `token` query param is absent, it reads the `iacms.sid` cookie, fetches the session from Redis, and synthesizes a short-lived JWT (8h) to pass to the Chat Service — allowing browser session users to use WebSocket without any additional auth step.

#### Route Proxy Map

| Gateway Path | Target Service | Path Rewrite |
|-------------|---------------|--------------|
| `/api/v1/auth/*` | IAM Service | `-> /auth/*` |
| `/api/v1/session/*` | Handled at gateway | (no proxy) |
| `/api/v1/users/*` | IAM Service | `-> /auth/users/*` |
| `/api/v1/tenants/*` | IAM Service | `-> /tenants/*` |
| `/api/v1/rbac/*` | IAM Service | `-> /rbac/*` |
| `/api/v1/platform/*` | IAM Service | `-> /platform/*` |
| `/api/v1/cases/*` | Case Engine | `-> /cases/*` |
| `/api/v1/assignments/*` | Case Engine | `-> /assignments/*` |
| `/api/v1/attachments/*` | Case Engine | `-> /attachments/*` |
| `/api/v1/workflows/*` | Case Engine | `-> /workflows/*` |
| `/api/v1/referrals/*` | Case Engine | `-> /referrals/*` |
| `/api/v1/dashboard/*` | Case Engine | `-> /dashboard/*` |
| `/api/v1/audit/*` | Audit Service | `-> /audit/*` |
| `/api/v1/integrations/*` | Integration Service | `-> /integrations/*` |
| `/api/v1/notifications/*` | Notification Service | `-> /notifications/*` |
| `/api/v1/files/*` | File Service | `-> /files/*` |
| `/api/v1/uploads/*` | File Service | `-> /uploads/*` |
| `/api/v1/chat/conversations/*` | Chat Service | `-> /conversations/*` |
| `/api/v1/chat/presence` | Chat Service | `-> /presence` |
| `/ws` | Chat Service | WebSocket upgrade |
| `/api/v1/graphql` | Apollo Server (inline) | served by gateway itself |
| `/api/v1/api-keys/*` | Handled at gateway | (no proxy) |
| `/api/v1/webhooks/*` | Handled at gateway | (no proxy) |

#### Password Change Gate

The `enforcePasswordChanged` middleware blocks all routes for users with `mustChangePassword: true`, except `/auth/change-password`, `/auth/profile`, `/session/logout`, and `/session/status`. This ensures admin-provisioned accounts cannot skip the first-login password reset.

---

### 5.2 IAM Service

**Port**: 3001 | **Container**: `iacms-iam-service`  
**Database Access**: Full schema (users, roles, permissions, tenants, departments)

A merged service handling **authentication, user management, tenant management, and RBAC** in one process. Originally split into Auth + RBAC services; merged to eliminate the synchronous HTTP roundtrip between them.

#### Responsibilities

| Module | Routes | Description |
|--------|--------|-------------|
| Authentication | `/auth/*` | Login (JWT), register, refresh, password reset, email verification, profile, change password |
| User Management | `/auth/users/*` | Admin CRUD for users within a tenant |
| Tenant Management | `/tenants/*` | Tenant registration, configuration, departments, logo upload, self-registration |
| RBAC | `/roles/*`, `/permissions/*`, `/user-roles/*` | Role/permission CRUD, user-role assignment, permission resolution |
| Platform Admin | `/platform/*` | Cross-tenant admin: agency approvals, quotas, announcements, feature flags, support tickets |
| OAuth Clients | `/oauth/clients/*` | CRUD for OAuth2 application registrations (admin only) |
| Static Assets | `/tenants/assets/*` | Serves tenant logo uploads |

#### Authentication Internals

**JWT Login flow**:
1. Validate `email + password + tenantCode` against the `users` table
2. Verify bcrypt hash (`bcryptjs`)
3. Sign JWT with `{id, email, tenantId, departmentId, roles, mustChangePassword}` payload
4. Sign refresh token (longer-lived; hash stored in DB for rotation validation)
5. Publish `user.logged_in` to Kafka (Audit Service persists this)

**Password reset flow**:
1. `POST /auth/forgot-password` — generate secure token, store hash + expiry
2. Publish `password.reset.requested` → Notification Service sends reset email
3. `POST /auth/reset-password` — verify token, bcrypt hash new password, clear token fields

**Email verification**:
1. On user creation — generate token, store in user record
2. Publish `email.verification.requested` → Notification Service sends verification email
3. `POST /auth/verify-email` — verify token, set `isEmailVerified = true`

#### Tenant Registration & Self-Registration

- **Platform admin registration** (`POST /tenants/register`): Requires `system_admin` role. Creates tenant, default department, and a seed tenant admin user with a temporary password delivered via email.
- **Self-registration** (`POST /tenants/self-register`): Public endpoint. Creates a tenant in **pending** state. Platform admin must approve via `POST /platform/agencies/:id/approve`. On approval, a `tenant.approved` event triggers a welcome email.

#### RBAC Data Model

```
Permission (resource:action — e.g. cases:read, workflows:update)
    └── RolePermission (M:M join table)
Role (tenant-scoped, or system-wide when tenantId = null)
    └── UserRole (user-role assignment with optional expiresAt)
User
```

Wildcard permissions (`resource:*` or `*`) grant full resource or platform access. `GET /permissions/user/:userId` returns the resolved flat permission list — called by the gateway RBAC middleware.

#### Platform Admin Panel

| Endpoint | Purpose |
|----------|---------|
| `GET /platform/agencies/pending` | List pending self-registrations |
| `POST /platform/agencies/:id/approve` | Approve agency, create admin user, send email |
| `POST /platform/agencies/:id/decline` | Decline with reason |
| `GET /platform/tenants` | All tenants with stats |
| `GET/PATCH /platform/settings` | Platform-wide configuration |
| `GET/POST /platform/feature-flags` | Feature flag management |
| `GET/POST /platform/announcements` | Platform-wide announcements |
| `GET/POST /platform/support-tickets` | Support ticket queue |
| `GET /platform/quotas` | Quota overview |
| `PATCH /platform/tenants/:id/quota` | Update tenant quota limits |

---

### 5.3 Case Engine Service

**Port**: 3003 | **Container**: `iacms-case-engine-service`  
**Database Access**: Cases, workflows, assignments, referrals, case history, departments

The heart of the platform. Handles **case lifecycle, workflow definition and execution, cross-agency referrals, work assignments, and case file attachment metadata**.

#### Route Modules

| Module | Base Route | Key Operations |
|--------|-----------|---------------|
| Cases | `/cases` | CRUD, list with filters, transitions, history |
| Workflows | `/workflows` | Design, version, publish, archive |
| Assignments | `/assignments` | Assign/unassign caseworkers |
| Referrals | `/referrals` | Create, accept, reject, complete inter-agency referrals |
| Attachments | `/attachments` | Link file service uploads to cases |
| Dashboard | `/dashboard` | Aggregated task and reporting queries |

#### Workflow Engine

Workflows define a directed graph of states (steps) and allowed transitions between them.

**Data model**:
```
Workflow (tenantId, key, version, status: DRAFT|PUBLISHED|ARCHIVED)
  +-- WorkflowStep  (key, name, isInitial, isFinal, allowedRoleIds, position)
  +-- WorkflowTransition (fromStepId -> toStepId, name, allowedRoleIds,
                          requiresComment, requiresAttachment, timeLimit)
```

**Lifecycle**:
- `DRAFT` — editable; steps and transitions can be freely modified
- `PUBLISHED` — locked; assigned to new cases; new versions can be branched from this
- `ARCHIVED` — unavailable for new cases; existing cases continue on it

**Versioning**: `POST /workflows/:id/new-version` creates a new row at `version+1` in DRAFT state, copying all steps and transitions.

#### Transition Engine (`services/transition.engine.js`)

When a case actor executes a transition:

1. **Validate tenant scope**: `x-tenant-id` must match `case.currentTenantId`
2. **Fetch workflow definition**: Resolve steps/transitions for the case version (in-memory cached)
3. **Validate applicability**: `transition.fromStepId === case.currentStepId`
4. **Enforce guards**:
   - `requiresComment`: body must include a non-empty `comment`
   - `requiresAttachment`: case must have at least one non-deleted attachment
   - `allowedRoleIds`: actor role IDs (from `x-user-roles`) must intersect with allowed roles
5. **Execute atomically** (`prisma.$transaction`):
   - Update `case.currentStepId` to `transition.toStepId`
   - If `toStep.isFinal`: set `case.closedAt` and `case.status = closed`
   - Append immutable `CaseHistory` row
6. **Publish events**:
   - `case.transitioned` → Notification Service
   - `audit.log` → Audit Service

#### Case Referral System

```
Originating Agency: POST /referrals
    CaseReferral: fromTenantId, toTenantId, status=pending
    Publishes: referral.created

Target Agency: POST /referrals/:id/accept
    referral.status = active
    case.currentTenantId = toTenantId
    Publishes: referral.accepted

Target Agency: POST /referrals/:id/complete
    referral.status = completed
    Publishes: referral.completed

Either side: POST /referrals/:id/reject
    referral.status = rejected
    case.currentTenantId reverts to originatingTenantId
    Publishes: referral.rejected
```

#### Case Number Generation

Format: `{YEAR}-{SEQ:04d}` (e.g., `2026-0042`). The `CaseSequence` table provides per-tenant, per-year atomic sequence increment via `prisma.$transaction` — gap-free and tenant-isolated.

#### Dashboard

- `GET /dashboard/tasks` — cases assigned to the requesting user, grouped by workflow step with due-date indicators
- `GET /dashboard/reports` — cross-tenant stats: case counts, open/closed ratios, referral stats, workflow throughput

---

### 5.4 Audit Service

**Port**: 3006 | **Container**: `iacms-audit-service`  
**Database Access**: `audit_logs` table only

A passive consumer service. Subscribes to `audit.log` Kafka topic and persists events to the `AuditLog` table.

**What emits `audit.log` events**:
- IAM Service: user login, password changes, role assignments
- Case Engine: case create/update/delete, transitions, referral state changes
- API Gateway: GraphQL partner API mutations (via `AuditOutbox` outbox pattern)

#### Audit Log Schema

```
AuditLog {
  tenantId        - owning tenant
  relatedTenantId - second tenant for cross-agency events
  entityType      - case, user, workflow, referral, file, etc.
  entityId        - UUID of the affected entity
  action          - case.created, user.login, case.transition, etc.
  userId          - who performed the action (null for system events)
  oldValues       - JSON snapshot before mutation
  newValues       - JSON snapshot after mutation
  ipAddress       - forwarded from gateway
  userAgent       - browser/client user agent
  createdAt       - immutable timestamp
}
```

#### Query API

| Endpoint | Description |
|----------|-------------|
| `GET /audit` | List logs with filters: `entityType`, `entityId`, `action`, `userId`, date range, pagination |
| `GET /audit/:id` | Get single log entry |
| `GET /audit/cases/:caseId` | Full audit trail for a specific case |
| `GET /audit/users/:userId/actions` | All actions performed by a user |
| `GET /audit/compliance/:tenantId` | Compliance export (supports `Accept: text/csv`) |

---

### 5.5 Integration Service

**Port**: 3007 | **Container**: `iacms-integration-service`  
**Database Access**: `integrations`, `webhooks` tables

Manages external system connectivity configurations, integration metadata, and registered webhook targets.

#### Architecture & Role

The Integration Service acts as the management registry for external connectors and tenant-configured webhooks:
- **Integration Registry**: Stores endpoint URLs, credentials (API keys/secrets), auth configurations, and sync schedules for external systems (e.g., municipal registries, police records systems).
- **Manual & Scheduled Sync**: Emits `integration.sync` events to Kafka when syncs are triggered, updating timestamps and `syncStatus` in PostgreSQL.
- **Webhook Registry**: Persists webhook subscription endpoints per tenant (`POST /webhooks`), recording subscription URLs, active states, and event filters.

#### Data Models

```
Integration {
  tenantId     - owning tenant
  name         - human-readable label
  type         - REST, SOAP, SFTP, etc.
  endpointUrl  - target external system URL
  config       - JSON configuration (headers, auth, field mappings)
  apiKey       - external system API key (omitted from read responses)
  apiSecret    - external system API secret (omitted from read responses)
  isActive     - boolean flag
  lastSyncAt   - timestamp of last successful sync
  syncStatus   - JSON metadata tracking sync status
}

Webhook {
  tenantId     - owning tenant
  name         - human-readable label
  url          - destination webhook URL (unique per tenant)
  secret       - shared signing secret for HMAC verification
  events       - string array of subscribed events
  isActive     - boolean flag
}
```

#### Routes & Operations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/integrations` | List tenant integrations (filtered by `tenantId`, `type`, `isActive`) |
| `POST` | `/integrations` | Register new integration (publishes `integration.created`) |
| `GET` | `/integrations/:id` | Get integration details (masks sensitive credentials) |
| `PUT` | `/integrations/:id` | Update configuration (publishes `integration.updated`) |
| `DELETE` | `/integrations/:id` | Remove integration |
| `POST` | `/integrations/:id/sync` | Trigger manual sync (publishes `integration.sync`) |
| `GET` | `/webhooks` | List registered webhooks |
| `POST` | `/webhooks` | Create webhook subscription (publishes `webhook.created`) |
| `GET` | `/webhooks/:id` | Get webhook details |
| `PUT` | `/webhooks/:id` | Update webhook subscription |
| `DELETE` | `/webhooks/:id` | Remove webhook subscription |

---

### 5.6 Notification Service

**Port**: 3008 | **Container**: `iacms-notification-service`  
**Storage & Cache**: Redis (in-app notifications, unread counts, Web Push subscriptions)  
**Database Access**: None (stateless Kafka consumer + Redis for delivery)

A hybrid event-driven and push delivery service. It processes incoming Kafka events, sends transactional emails via SMTP, manages an in-app notification inbox in Redis, broadcasts real-time toast alerts through Redis Pub/Sub to WebSockets, and delivers desktop browser notifications via Web Push (VAPID).

#### Architecture & Delivery Channels

1. **Email Channel (SMTP)**: Uses Nodemailer to format and deliver transactional emails for lifecycle events (welcome emails, password resets, verification links, case assignments).
2. **In-App Notification Inbox (Redis)**:
   - Stores up to 100 recent notifications per user in a Redis list (`notifications:{recipientId}`).
   - Maintains an atomic unread counter in Redis (`notifications:unread:{recipientId}`).
3. **Real-Time WebSocket Popups (Redis Pub/Sub)**:
   - Publishes `NOTIFICATION_CREATED` payloads to the Redis `chat:pubsub` channel.
   - The Gateway / Chat WebSocket server picks up the event and immediately forwards it to the active browser session.
4. **Desktop Push Notifications (Web Push / VAPID)**:
   - Persists browser push subscription endpoints (`push:subs:{recipientId}`).
   - Dispatches encrypted desktop push alerts using Web Push with ECDSA VAPID keys.

#### Kafka Subscriptions

| Topic | Triggered Notification |
|-------|------------------------|
| `user.created` | Welcome email with initial credentials |
| `password.reset.requested` | Password reset link email |
| `password.changed` | Security confirmation of password change |
| `email.verification.requested` | Email verification token link |
| `tenant.approved` | Agency registration approval notification |
| `case.created` | Case creation alert to tenant caseworkers |
| `case.assigned` | Assignment alert to the designated caseworker |
| `case.transitioned` | Case status transition update to stakeholders |
| `referral.created` | Referral notification to target agency case managers |
| `referral.accepted` | Referral acceptance alert to originating agency |
| `referral.rejected` | Referral rejection alert with reason to originating agency |
| `file.virus.found` | Security alert to tenant administrators |

#### Startup Resilience

Kafka subscriptions are registered together in a single tick before starting the consumer runner (addressing KafkaJS protocol constraints). If Kafka brokers are temporarily unreachable at startup, the service continues running its HTTP and Redis services and logs a retry warning every 60 seconds without blocking health probes.

#### REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/notifications` | Retrieve user notification list and unread count |
| `POST` | `/notifications` | Create and dispatch in-app notification & web push |
| `PATCH` | `/notifications/read-all` | Mark all notifications as read for current user |
| `PATCH` | `/notifications/:id/read` | Mark a single notification as read |
| `GET` | `/notifications/vapid-public-key` | Fetch VAPID public key for Web Push client setup |
| `POST` | `/notifications/push-subscription` | Register or update browser push subscription |

#### Configuration

- **Email**: SMTP via Nodemailer (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
- **Web Push**: VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
- **Redis**: Connection strings (`REDIS_URL`, default `redis://localhost:6379`)

---

### 5.7 File Service

**Port**: 3009  
**Containers**: `iacms-file-service` (HTTP) + `iacms-file-service-workers` (background)  
**Database Access**: `files`, `chunk_uploads`, `chunks`, `service_retention_policies`  
**Storage**: MinIO (default), AWS S3, or local disk

The most architecturally sophisticated service. Uses a layered DDD architecture to handle uploads, virus scanning, compression, thumbnail generation, lifecycle management, and Kafka events.

#### DDD Architecture

```
HTTP Layer (api/)
  Routes -> Controllers
    Application Layer (application/services/)
      PipelineService - orchestrates file processing stages
        Infrastructure Layer (infrastructure/)
          storage/     -> StorageFactory (MinIO / S3 / Local)
          virusScan/   -> ClamAVScanner (TCP to ClamAV daemon)
          compression/ -> image (WebP) / video (ffmpeg) compressors
          thumbnail/   -> sharp-based thumbnail generation
          queue/       -> KafkaPublisher, KafkaConsumer
          cache/       -> Redis cache adapter
          metrics/     -> Prometheus-compatible counters
          persistence/ -> PrismaFileRepository
```

#### File Processing Pipeline

```
Upload --> PENDING
    | VirusScanWorker
    +-- FAILED (virus found) --> deleted from storage + kafka event
    +-- SCANNING --> PROCESSING
                        | MetadataWorker   (extracts EXIF/media metadata)
                        | CompressionWorker (images/video, if enabled)
                        | ThumbnailWorker   (128/256/512px, if enabled)
                        --> AVAILABLE (ready for download)
```

Each worker uses atomic status compare-and-swap (`transitionStatus(fileId, from, to)`) preventing two workers from processing the same file simultaneously.

#### Workers

| Worker | Polls Status | Action |
|--------|-------------|--------|
| `VirusScanWorker` | `PENDING` | ClamAV scan; transitions to `PROCESSING` or `FAILED` |
| `MetadataWorker` | `PROCESSING` | Extracts EXIF/media metadata |
| `CompressionWorker` | `PROCESSING` | Compresses images (WebP) and video (ffmpeg) |
| `ThumbnailWorker` | `PROCESSING` | Generates thumbnail variants |
| `CleanupWorker` | `AVAILABLE` | Soft/hard-deletes files past retention policy |
| `RetryWorker` | `FAILED` | Re-queues failed files with `retryAt <= now` |
| `ExpiredChunkWorker` | — | Cleans up abandoned chunked uploads |

**Worker mode**: `WORKER_MODE=embedded` runs workers in the HTTP process (dev). `WORKER_MODE=standalone` uses a separate container (production) enabling independent scaling.

#### Chunked Upload Protocol

```
POST /uploads/init
  Body: { service, module, ownerId, referenceId, originalName, mimeType,
          totalSize, totalChunks, chunkSize }
  Response: { uploadId, expiresAt }

PUT /uploads/:uploadId/chunks/:chunkNumber
  Body: binary chunk data

POST /uploads/:uploadId/complete
  -> merges all chunks -> creates File record -> starts pipeline

GET /uploads/:uploadId/status
  Response: { status, receivedChunks, totalChunks }
```

#### Storage Abstraction

`StorageFactory.getInstance()` returns the configured provider. All providers implement: `upload()`, `download()`, `delete()`, `exists()`, `getSignedUrl()`.

| Provider | `STORAGE_PROVIDER` | Use Case |
|---------|-------------------|---------|
| MinIO | `minio` (default) | Docker dev + on-premise production |
| AWS S3 | `s3` | Cloud production |
| Local | `local` | Development without MinIO |

#### Virus Scanning

When `VIRUS_SCAN_ENABLED=true`: file buffer sent via TCP to ClamAV daemon. On infection: status `FAILED`, storage deleted, `file.virus.found` event published. When disabled (default in dev): files skip scanning and go directly to `PROCESSING`.

#### Observability

- `GET /health` — liveness probe
- `GET /ready` — readiness probe (DB + storage + Redis)
- `GET /metrics` — Prometheus-compatible metrics (upload counts, bytes, scan results)

---

### 5.8 Chat Service

**Port**: 3010  
**Containers**: `iacms-chat-service` (HTTP + WS) + `iacms-chat-service-worker` (outbox)  
**Database Access**: chat_conversations, chat_participants, chat_messages, chat_attachments, chat_reactions, chat_outbox_events

Real-time messaging for caseworkers within a tenant. Supports 1:1 direct messages and group conversations.

#### REST API

| Resource | Routes | Description |
|----------|--------|-------------|
| Conversations | `GET/POST /conversations` | List, create direct/group |
| Conversations | `GET/PATCH/DELETE /conversations/:id` | Get, update, archive |
| Messages | `GET/POST /conversations/:id/messages` | List (paginated), send |
| Messages | `PATCH/DELETE /conversations/:id/messages/:msgId` | Edit, soft-delete |
| Participants | `GET/POST /conversations/:id/participants` | List, add |
| Participants | `DELETE /conversations/:id/participants/:userId` | Remove |
| Reactions | `POST/DELETE /conversations/:id/messages/:msgId/reactions` | Toggle emoji |
| Presence | `POST /presence` | Bulk online status query |

#### WebSocket Protocol (`/ws?token=<jwt>`)

**Client -> Server**:
```json
{ "type": "SUBSCRIBE_CONVERSATION", "conversationId": "..." }
{ "type": "TYPING_START", "conversationId": "..." }
{ "type": "SEND_MESSAGE", "conversationId": "...", "content": "...", "clientMessageId": "..." }
{ "type": "MARK_READ", "conversationId": "...", "messageId": "..." }
{ "type": "PING" }
```

**Server -> Client**:
```json
{ "type": "MESSAGE_CREATED", "message": { ... } }
{ "type": "TYPING_START", "conversationId": "...", "userId": "..." }
{ "type": "PRESENCE_CHANGED", "userId": "...", "online": true }
{ "type": "REACTION_ADDED", "messageId": "...", "emoji": "...", "userId": "..." }
{ "type": "PONG" }
```

#### Presence System

Redis-backed. Connection sets a Redis key with short TTL; heartbeat renews it; disconnect lets it expire. `POST /presence` returns `{ userId: online }` for a list of user IDs.

#### Message Idempotency

Each message has a `clientMessageId` (client-generated UUID). The `(conversationId, clientMessageId)` pair has a unique DB constraint — network retries cannot create duplicates.

#### Outbox Pattern for WebSocket Fanout

New messages are saved to DB, then a `ChatOutboxEvent` is written in the same transaction. The `chat-service-worker` container polls this table and fans events to all connected WebSocket clients via Redis Pub/Sub — guaranteeing delivery even when the originating HTTP process differs from the one holding the WebSocket connections.

---

## 6. Cross-Cutting Concerns

### 6.1 Authentication & Authorization

#### Authentication Methods

| Method | Mechanism | Use Case | Storage |
|--------|-----------|---------|---------|
| Session | `iacms.sid` cookie -> Redis lookup | Web browsers | Redis (`sess:{sid}`) |
| JWT Bearer | `Authorization: Bearer <token>` | Mobile/API clients | Stateless (signed with `JWT_SECRET`) |
| API Key | `X-API-Key: iacms_live_*` | Partner integrations | DB (`api_keys` table, SHA-256 hash) |

#### RBAC Authorization

1. Gateway RBAC middleware resolves user permissions from Redis (5-min TTL cache)
2. Each route maps to a required permission string (e.g., `cases:read`, `workflows:update`)
3. Some routes accept OR-semantics — user needs **any one** from a list
4. Permissions forwarded downstream via `x-user-permissions` and `x-user-roles` headers
5. `system_admin` role receives `platform:manage_tenants` for full platform access

#### API Key Scopes

Keys carry a `scopes` array. The `@requireScope` GraphQL directive enforces scope membership before resolvers execute. Available scopes: `cases:read`, `referrals:read`, `referrals:create`, `workflows:read`, `audit:read`.

#### mustChangePassword Gate

Users with `mustChangePassword = true` receive `403 MUST_CHANGE_PASSWORD` on all endpoints except `POST /auth/change-password`, `GET /auth/profile`, `POST /session/logout`, `GET /session/status`. Reconciled between JWT and database on every request with a 5-minute negative cache.

---

### 6.2 Event-Driven Communication (Kafka)

#### Topic Registry

| Topic | Publisher(s) | Consumer(s) |
|-------|-------------|-------------|
| `user.created` | IAM | Notification |
| `user.logged_in` | IAM | Audit |
| `tenant.approved` | IAM | Notification |
| `password.reset.requested` | IAM | Notification |
| `password.changed` | IAM | Notification |
| `email.verification.requested` | IAM | Notification |
| `case.created` | Case Engine | Notification, Audit |
| `case.updated` | Case Engine | Audit |
| `case.assigned` | Case Engine | Notification, Audit |
| `case.transitioned` | Case Engine | Notification, Audit |
| `case.deleted` | Case Engine | Audit |
| `referral.created` | Case Engine | Notification, Audit |
| `referral.accepted` | Case Engine | Notification, Audit |
| `referral.rejected` | Case Engine | Notification, Audit |
| `referral.completed` | Case Engine | Audit |
| `workflow.published` | Case Engine | Audit |
| `audit.log` | All services | Audit |
| `file.uploaded` | File Service | Audit |
| `file.processed` | File Service | Audit |
| `file.virus.found` | File Service | Notification, Audit |
| `file.deleted` | File Service | Audit |
| `integration.created` | Integration Service | Audit |
| `integration.updated` | Integration Service | Audit |
| `integration.sync` | Integration Service | Integration Worker, Audit |
| `webhook.created` | Integration Service | Audit |

#### EventBus Resilience (`shared/utils/eventBus.js`)

- **Lazy producer**: Connects on first `publish()`, not at startup
- **Deferred consumer start**: All `subscribe()` calls in the same tick are batched before connecting — prevents the "only first topic subscribed" KafkaJS pitfall
- **CRASH handling**: On consumer crash, bus disconnects, recreates consumer, reconnects with exponential backoff (5s → 60s max)
- **Non-blocking publish**: Failures logged as warnings, not thrown — business operations continue

---

### 6.3 Internal Service Security

All services use the shared `requireInternalRequest()` middleware:
- Skips `/health` and configured `skipPaths`
- **Production**: requires `x-internal-service-token` header matching `INTERNAL_SERVICE_TOKEN` env var; 403 if missing/wrong
- **Development** with no token: passes through for direct service debugging

The API Gateway attaches `x-internal-service-token` to every proxied request. In production, only port `3000` is published — services are unreachable from outside the Docker network.

`assertProductionSecrets()` runs at every service startup. In `NODE_ENV=production`, missing or insecure default secrets cause the process to exit before accepting requests.

---

### 6.4 Multi-Tenancy

Every model containing tenant-specific data has a `tenant_id` column. Services enforce tenant scope using the `x-tenant-id` header forwarded by the gateway.

**Isolation levels**:
- **Data isolation**: All queries include `WHERE tenant_id = $tenantId`
- **Cross-tenant access**: Only via explicit `CaseReferral` — `case.currentTenantId` changes, giving the receiving tenant access
- **Audit visibility**: Platform admins query all tenants via `relatedTenantId` joins
- **Role isolation**: Roles are scoped to `tenantId` (system roles have `tenantId = null`)
- **Department sub-scoping**: Users and cases can be further scoped to `departmentId`

---

## 7. Database Schema

Single PostgreSQL database (`iacms`) managed by one Prisma schema at `prisma/schema.prisma`.

### Table Reference

| Table | Description |
|-------|-------------|
| `tenants` | Organizations using the platform |
| `departments` | Sub-units within a tenant |
| `users` | Individual accounts; belongs to tenant + optional department |
| `roles` | Permission groups; tenant-scoped or system-wide (`tenantId = null`) |
| `permissions` | Atomic `resource:action` grants |
| `user_roles` | User-role assignments with optional `expiresAt` |
| `workflows` | Case progression templates; versioned |
| `workflow_steps` | Graph nodes; `isInitial`, `isFinal`, `allowedRoleIds` |
| `workflow_transitions` | Graph edges; guards: `requiresComment`, `requiresAttachment`, `allowedRoleIds`, `timeLimit` |
| `cases` | Individual case records; linked to workflow + current step; custom `data` JSON |
| `case_history` | Immutable log of every transition |
| `case_sequences` | Per-tenant per-year counters for `YYYY-NNNN` case numbers |
| `assignments` | Caseworker-case mappings with timestamps |
| `case_referrals` | Cross-agency case transfers with full lifecycle status |
| `case_attachments` | Metadata links from cases to File Service uploads |
| `audit_logs` | Immutable compliance event log |
| `audit_outbox` | Transactional outbox for Kafka + webhooks; written atomically with business data |
| `webhooks` | Tenant webhook subscriptions (URL, events array, retry config, HMAC secret) |
| `integrations` | External system connections |
| `api_keys` | Partner API keys (SHA-256 hash, scopes array, expiry) |
| `files` | File metadata; status: `PENDING -> SCANNING -> PROCESSING -> AVAILABLE/FAILED` |
| `chunk_uploads` | In-progress chunked uploads; tracks received vs expected chunks |
| `chunks` | Individual upload chunks |
| `service_retention_policies` | Per-service file retention rules applied by CleanupWorker |
| `chat_conversations` | Messaging threads (`DIRECT` or `GROUP`) |
| `chat_participants` | Conversation membership; role: `MEMBER/ADMIN/OWNER`; tracks read state |
| `chat_messages` | Messages; soft-deletable; supports thread replies via `replyToId` |
| `chat_attachments` | Files attached to messages (references File Service) |
| `chat_reactions` | Emoji reactions; unique per `(user, message, emoji)` |
| `chat_outbox_events` | Transactional outbox for WS fanout; `PENDING -> PUBLISHING -> PUBLISHED/FAILED` |
| `oauth_clients` | OAuth2 application registrations (WIP — see note) |
| `oauth_consents` | User consent records for OAuth scopes (WIP) |
| `oauth_providers` | External IdP configs: Google, Microsoft, SAML (WIP) |
| `federated_identities` | Social login links; maps external `sub` to internal user (WIP) |
| `oidc_payloads` | Generic node-oidc-provider storage for all OIDC artefact types (WIP) |

### Per-Service Prisma Client Mapping

| Generator | Output Path | Primary Models |
|-----------|------------|---------------|
| `clientIam` | `services/iam-service/src/generated/prisma` | users, tenants, departments, roles, permissions, userRoles |
| `clientCaseEngine` | `services/case-engine-service/src/generated/prisma` | cases, workflows, workflowSteps, workflowTransitions, assignments, caseReferrals, caseHistory |
| `clientAudit` | `services/audit-service/src/generated/prisma` | auditLog |
| `clientIntegration` | `services/integration-service/src/generated/prisma` | integration, webhook |
| `clientFile` | `services/file-service/src/generated/prisma` | file, chunkUpload, chunk, serviceRetentionPolicy |
| `clientGateway` | `services/api-gateway/src/generated/prisma` | apiKey, auditOutbox, webhook |

Regenerate all clients: `npx prisma generate` from repo root.

---

## 8. Partner & Integration APIs

### 8.1 GraphQL Partner API

**Endpoint**: `POST /api/v1/graphql`  
**Authentication**: `X-API-Key: iacms_live_*`

#### Schema Features

- **`@requireScope` directive**: Rejects requests without the required scope before resolvers run
- **Cost + depth limiting** (`costLimiter.plugin.js`): Prevents expensive nested queries
- **Audit logging plugin** (`audit.plugin.js`): Writes every mutation to `AuditOutbox` atomically — enables the Webhook delivery pipeline
- **Introspection**: Disabled in production unless `GRAPHQL_INTROSPECTION=true`
- **Apollo Sandbox**: Available in development at `GET /api/v1/graphql`

#### Available Operations

```graphql
# Queries (scope: cases:read, referrals:read)
query { cases(filter: {...}, pagination: {...}) { id caseNumber title status } }
query { case(id: "...") { ... } }
query { referrals(filter: {...}) { ... } }
query { referral(id: "...") { ... } }

# Mutations (scope: cases:create, referrals:create)
mutation { createCase(input: {...}) { id caseNumber } }
mutation { executeTransition(caseId: "...", transitionId: "...") { ... } }
mutation { createReferral(input: {...}) { ... } }
```

---

### 8.2 Webhook System

Tenants register webhook URLs to receive real-time HTTP notifications.

**Registration** (`POST /api/v1/webhooks`):
```json
{
  "name": "My Integration",
  "url": "https://partner.gov/iacms-events",
  "secret": "hmac-signing-secret",
  "events": ["case.created", "case.status_changed", "referral.created"],
  "retryCount": 3,
  "timeoutMs": 15000
}
```

**Delivery** (via `webhookDispatcher.js` worker):
1. Maps GraphQL mutations to event names (`createCase -> case.created`, etc.)
2. Loads active webhooks for the tenant subscribing to that event
3. Delivers HMAC-SHA256 signed POST (`X-IACMS-Signature` header)
4. Retries up to `retryCount` times on failure
5. Marks outbox record dispatched only after all webhooks are attempted

---

### 8.3 API Key Management

| Endpoint | Action |
|----------|--------|
| `POST /api/v1/api-keys` | Create key (raw key returned once only) |
| `GET /api/v1/api-keys` | List keys (shows prefix, not secret) |
| `DELETE /api/v1/api-keys/:id` | Revoke key |
| `POST /api/v1/api-keys/:id/rotate` | Rotate to new secret |
| `GET /api/v1/api-keys/scopes` | List available scopes |

---

## 9. Infrastructure & Deployment

### Container Inventory

| Container | Image | Purpose |
|-----------|-------|---------|
| `iacms-postgres` | `postgres:15-alpine` | Primary database |
| `iacms-redis` | `redis:7-alpine` | Sessions, RBAC cache, rate limiting, presence |
| `iacms-kafka` | `confluentinc/cp-kafka:7.5.0` | Event streaming (KRaft mode) |
| `iacms-api-gateway` | Custom | Single public entry point |
| `iacms-iam-service` | Custom | Auth + RBAC + Tenant management |
| `iacms-case-engine-service` | Custom | Case lifecycle + Workflows + Referrals |
| `iacms-audit-service` | Custom | Audit trail consumer + query API |
| `iacms-integration-service` | Custom | External system integrations |
| `iacms-notification-service` | Custom | Email/push notification consumer |
| `iacms-file-service` | Custom (`target: http`) | File management HTTP API |
| `iacms-file-service-workers` | Custom (`target: workers`) | Background file processing |
| `iacms-chat-service` | Custom | Messaging REST API + WebSocket server |
| `iacms-chat-service-worker` | Custom | Chat outbox publisher |
| `iacms-minio` | `quay.io/minio/minio` | S3-compatible object storage |
| `iacms-minio-init` | `quay.io/minio/mc` | One-shot bucket initialization |
| `iacms-clamav` | `clamav/clamav:stable` | Virus scanning daemon (optional) |

### Development vs Production

| Aspect | Development | Production |
|--------|------------|------------|
| Published ports | All services on host | Only API Gateway :3000 |
| Worker mode | `WORKER_MODE=embedded` | `WORKER_MODE=standalone` |
| Virus scan | Disabled by default | Enabled recommended |
| Secret validation | Passes if token not set | Fails process on missing/weak secrets |

### Production Secrets

```bash
JWT_SECRET=$(openssl rand -base64 64)
SESSION_SECRET=$(openssl rand -base64 48)
INTERNAL_SERVICE_TOKEN=$(openssl rand -base64 32)
```

Deploy with:
```bash
cd infrastructure
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

### LAN Development

```bash
npm run network:env    # Auto-detects LAN IP, writes infrastructure/.env
cd infrastructure && docker compose up -d
# Set VITE_API_URL=http://<lan-ip>:3000 in the frontend
```

---

## 10. Shared Library

Located at `shared/` — referenced by all services via relative path.

### `shared/common/`

| File | Description |
|------|-------------|
| `logger.js` | Structured logger (Winston), prefixed by service name |
| `errors.js` | Custom error classes: `NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError`, `UnauthorizedError`, `InvalidTransitionError`, `WorkflowNotPublishedError` |

### `shared/middleware/`

| File | Description |
|------|-------------|
| `errorHandler.js` | Maps custom error classes to HTTP status codes |
| `requireInternalRequest.js` | Blocks direct service access; validates `x-internal-service-token` |
| `tenantContext.js` | Extracts `x-tenant-id` into `req.tenantId` |
| `gatewayIdentity.js` | Forwards gateway-stamped identity headers downstream |

### `shared/utils/`

| File | Description |
|------|-------------|
| `eventBus.js` | Kafka producer/consumer abstraction with reconnect logic + TOPICS registry |
| `validateProductionSecrets.js` | Startup production secret validation |
| `userRoles.js` | `loadUserRoleIdsForUser(prisma, userId)` helper |

### `shared/swagger.js`

`setupSwagger(app, serviceName, port)` — mounts Swagger UI at `/api-docs` and JSON spec at `/api-docs.json` for every service.

---

## 11. API Reference

### Gateway Health
```
GET  /health                              -> service status + enabled features
GET  /api/v1/platform/service-probes      -> live HTTP probe of all downstream services
```

### Session Authentication
```
POST /api/v1/session/login    { email, password, tenantCode }  -> sets iacms.sid cookie
GET  /api/v1/session/status                                     -> { user, mustChangePassword }
POST /api/v1/session/logout                                     -> destroys session
POST /api/v1/session/refresh                                    -> extends session TTL
```

### JWT Authentication
```
POST /api/v1/auth/login              { email, password, tenantCode }  -> { accessToken, refreshToken }
GET  /api/v1/auth/profile                                             -> { user }
POST /api/v1/auth/refresh            { refreshToken }                 -> { accessToken }
POST /api/v1/auth/forgot-password    { email, tenantCode }            -> 204
POST /api/v1/auth/reset-password     { token, password }              -> 200
POST /api/v1/auth/change-password    { currentPassword, newPassword } -> 200
POST /api/v1/auth/verify-email       { token }                        -> 200
```

### Users
```
POST   /api/v1/auth/users/create           -> Create user (admin)
GET    /api/v1/auth/users                  -> List tenant users
GET    /api/v1/auth/users/:id              -> Get user
PATCH  /api/v1/auth/users/:id              -> Update user
PATCH  /api/v1/auth/users/:id/deactivate   -> Deactivate
PATCH  /api/v1/auth/users/:id/reactivate   -> Reactivate
```

### Tenants & Departments
```
GET    /api/v1/tenants                     -> List tenants
GET    /api/v1/tenants/validate/:code      -> Validate tenant code (public)
POST   /api/v1/tenants/self-register       -> Public self-registration (pending state)
POST   /api/v1/tenants/register            -> Admin-create tenant (system_admin only)
PUT    /api/v1/tenants/:id                 -> Update tenant
PATCH  /api/v1/tenants/:id/config          -> Update config JSON
POST   /api/v1/tenants/:id/logo            -> Upload logo
GET    /api/v1/tenants/:id/departments     -> List departments
POST   /api/v1/tenants/:id/departments     -> Create department
```

### RBAC
```
GET    /api/v1/rbac/roles                  -> List roles
POST   /api/v1/rbac/roles                  -> Create role
PUT    /api/v1/rbac/roles/:id              -> Update role
DELETE /api/v1/rbac/roles/:id              -> Delete role
POST   /api/v1/rbac/user-roles/assign      -> Assign role to user
POST   /api/v1/rbac/user-roles/revoke      -> Revoke role from user
GET    /api/v1/rbac/users/:id              -> Get user with roles
GET    /api/v1/rbac/users                  -> List users with roles
```

### Cases
```
GET    /api/v1/cases                            -> List cases
POST   /api/v1/cases                            -> Create case
GET    /api/v1/cases/:id                        -> Get case
PUT    /api/v1/cases/:id                        -> Update case
DELETE /api/v1/cases/:id                        -> Soft-delete
GET    /api/v1/cases/:id/history                -> Transition history
POST   /api/v1/cases/:id/transitions/:tid/execute -> Execute transition
POST   /api/v1/cases/:id/close                  -> Force close
POST   /api/v1/cases/:id/assign                 -> Assign to user
GET    /api/v1/cases/:id/assignments            -> List assignments
```

### Workflows
```
GET    /api/v1/workflows                   -> List workflows
POST   /api/v1/workflows                   -> Create (DRAFT)
GET    /api/v1/workflows/published         -> List published
GET    /api/v1/workflows/:id/full          -> Get with steps + transitions
POST   /api/v1/workflows/:id/publish       -> Publish (DRAFT -> PUBLISHED)
POST   /api/v1/workflows/:id/archive       -> Archive (PUBLISHED -> ARCHIVED)
POST   /api/v1/workflows/:id/new-version   -> Branch new draft version
POST   /api/v1/workflows/:id/steps         -> Add step
PUT    /api/v1/workflows/:id/steps/:sid    -> Update step
DELETE /api/v1/workflows/:id/steps/:sid    -> Remove step
POST   /api/v1/workflows/:id/transitions   -> Add transition
PUT    /api/v1/workflows/:id/transitions/:tid -> Update transition
DELETE /api/v1/workflows/:id/transitions/:tid -> Remove transition
```

### Referrals
```
GET    /api/v1/referrals                   -> List referrals
POST   /api/v1/referrals                   -> Create referral
GET    /api/v1/referrals/:id               -> Get referral
POST   /api/v1/referrals/:id/accept        -> Accept (target agency)
POST   /api/v1/referrals/:id/assign        -> Assign to department
POST   /api/v1/referrals/:id/reject        -> Reject
POST   /api/v1/referrals/:id/complete      -> Complete
```

### Files
```
POST   /api/v1/files                       -> Upload single file (multipart/form-data)
POST   /api/v1/files/batch                 -> Upload multiple files
GET    /api/v1/files                       -> List files
GET    /api/v1/files/:id                   -> Get metadata
GET    /api/v1/files/:id/download          -> Download stream
GET    /api/v1/files/:id/view              -> Inline view
GET    /api/v1/files/:id/stream            -> Byte-range streaming (video)
GET    /api/v1/files/:id/signed-url        -> Pre-signed URL
DELETE /api/v1/files/:id                   -> Soft-delete

POST   /api/v1/uploads/init                -> Initialize chunked upload
PUT    /api/v1/uploads/:id/chunks/:n       -> Upload chunk n
POST   /api/v1/uploads/:id/complete        -> Finalize
GET    /api/v1/uploads/:id/status          -> Progress check
```

### Chat
```
GET    /api/v1/chat/conversations                    -> List conversations
POST   /api/v1/chat/conversations                    -> Create
GET    /api/v1/chat/conversations/:id/messages       -> List messages
POST   /api/v1/chat/conversations/:id/messages       -> Send message
POST   /api/v1/chat/presence                         -> Bulk presence check
WS     /ws?token=<jwt>                               -> WebSocket connection
```

### Audit
```
GET    /api/v1/audit                        -> Query audit logs
GET    /api/v1/audit/:id                    -> Get single entry
GET    /api/v1/audit/cases/:caseId          -> Audit trail for case
GET    /api/v1/audit/users/:userId/actions  -> Actions by user
GET    /api/v1/audit/compliance/:tenantId   -> Compliance export (CSV supported)
```

### Platform Admin (system_admin only)
```
GET    /api/v1/platform/agencies/pending         -> Pending self-registrations
POST   /api/v1/platform/agencies/:id/approve     -> Approve agency
POST   /api/v1/platform/agencies/:id/decline     -> Decline with reason
GET    /api/v1/platform/tenants                  -> All tenants with stats
GET    /api/v1/platform/service-probes           -> Live connectivity probes
```

### Notifications
```
GET    /api/v1/notifications                     -> List user notifications & unread count
POST   /api/v1/notifications                     -> Create & dispatch notification
PATCH  /api/v1/notifications/read-all            -> Mark all as read for current user
PATCH  /api/v1/notifications/:id/read            -> Mark single notification as read
GET    /api/v1/notifications/vapid-public-key    -> Retrieve VAPID public key
POST   /api/v1/notifications/push-subscription   -> Register Web Push subscription
```

### Integrations
```
GET    /api/v1/integrations                      -> List external integration configs
POST   /api/v1/integrations                      -> Register new external integration
GET    /api/v1/integrations/:id                  -> Get integration details (safe view)
PUT    /api/v1/integrations/:id                  -> Update configuration
DELETE /api/v1/integrations/:id                  -> Delete integration
POST   /api/v1/integrations/:id/sync             -> Trigger manual sync
```

### Webhooks
```
GET    /api/v1/webhooks/events                   -> List supported event names
GET    /api/v1/webhooks                          -> List tenant webhooks
POST   /api/v1/webhooks                          -> Create webhook subscription
GET    /api/v1/webhooks/:id                      -> Get webhook subscription
PATCH  /api/v1/webhooks/:id                      -> Update URL, events, or active state
DELETE /api/v1/webhooks/:id                      -> Delete subscription
```

### API Keys
```
GET    /api/v1/api-keys/scopes                   -> List assignable scopes (*, cases:read, etc.)
POST   /api/v1/api-keys                          -> Create API key (returns raw key once)
GET    /api/v1/api-keys                          -> List active keys (masked prefix only)
DELETE /api/v1/api-keys/:id                      -> Revoke key
POST   /api/v1/api-keys/:id/rotate               -> Rotate key (returns new raw secret)
```

### Partner GraphQL API
```
POST   /api/v1/graphql                           -> Query & mutation endpoint
Headers:
  X-API-Key: iacms_live_<token>
  Content-Type: application/json

Supported Queries:
  cases(filter, pagination), case(id)
  referrals(filter), referral(id)

Supported Mutations:
  createCase(input)
  executeTransition(caseId, transitionId, comment)
  createReferral(input)
```

---

## 12. Development Guide

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- Node.js 20+
- Postman (for API testing)

### First-Time Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit: JWT_SECRET, SESSION_SECRET, INTERNAL_SERVICE_TOKEN

# 3. Start backing infrastructure
cd infrastructure
docker compose up -d postgres redis kafka minio minio-init

# 4. Run migrations and seed
cd ..
npx prisma migrate deploy
npx prisma db seed

# 5. Start all services in Docker (Option A)
cd infrastructure && docker compose up -d
```

### Running Services Natively (Option B — Fast Dev)

When developing or debugging with breakpoints and instant hot reloads without container rebuilds:

```bash
# Start infrastructure containers only
npm run docker:up

# Start all 8 microservices sequentially with file-based logs (avoids terminal backpressure)
./scripts/start-services.sh

# Or start services sequentially via docker:
./start_services_sequentially.sh

# Monitor logs
tail -f /tmp/iacms-logs/*.log
```

### Running Test Suites

IACMS uses Vitest across all services and shared modules:

```bash
# Run all tests (shared library + microservice test suites)
npm run test:all

# Run shared library unit tests
npm run test:shared

# Run unit tests across all microservices
npm run test:services

# Run API gateway tests specifically
npm run test:gateway

# Run integration tests across all microservices
npm run test:services:integration
```

### Postman Collections & Testing Utilities

Pre-configured Postman collections with automated environment variables and pre-request token generation are included in the repository root:
- `IACMS_Platform_API.postman_collection.json`: Comprehensive collection covering Cases, Workflows, Referrals, Files, Audit, Notifications, Integrations, and Chat.
- `IACMS_Auth_Postman_Collection.json`: Dedicated authentication flows, session handling, password reset, and role management tests.

### After Schema Changes

```bash
npx prisma migrate dev --name <migration_name>   # Create + apply migration (dev)
npx prisma migrate deploy                         # Apply pending migrations (CI/prod)
npx prisma generate                               # Regenerate all per-service clients
```

### Seeded Test Credentials

| Role | Email | Password | Tenant Code |
|------|-------|----------|------------|
| System Admin | `admin@test-org.com` | `password123` | `TEST-ORG` |
| Tenant Admin | `tenant-admin@test-org.com` | `password123` | `TEST-ORG` |
| Case Manager | `manager@test-org.com` | `password123` | `TEST-ORG` |
| Case Worker | `worker@test-org.com` | `password123` | `TEST-ORG` |

### Useful Commands

```bash
# Watch Kafka events in real time
docker exec iacms-kafka kafka-console-consumer \
  --bootstrap-server localhost:29092 --topic case.created --from-beginning

# Database GUI
npx prisma studio

# Direct DB access
docker exec -it iacms-postgres psql -U postgres -d iacms

# MinIO Console
open http://localhost:9001   # minioadmin / minioadmin
```

---

## 13. Operational Runbook

### Health Checks

```bash
# Gateway
curl http://localhost:3000/health

# All downstream probes (requires auth)
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/platform/service-probes

# Individual services
for port in 3001 3003 3006 3007 3008 3009 3010; do
  echo -n "Port $port: "; curl -s http://localhost:$port/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "unreachable"
done

# File Service readiness (DB + Storage + Redis)
curl http://localhost:3009/ready

# Prometheus metrics
curl http://localhost:3009/metrics
```

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| 401 on all requests | Missing or expired JWT | Re-login and get a new token |
| 403 POLICY_UNAVAILABLE | IAM Service unreachable | Check IAM health and logs |
| 503 SERVICE_UNAVAILABLE | Target microservice is down | `docker compose ps`, restart if crashed |
| 504 GATEWAY_TIMEOUT | Service not responding within 120s | Check service logs; look for OOM or Kafka block |
| Notifications not arriving | Kafka consumer not connected | Check notification-service logs |
| Audit logs missing events | Kafka subscription failed | Check audit-service logs |
| Files stuck in PENDING | VirusScanWorker crashed or ClamAV not ready | Set `VIRUS_SCAN_ENABLED=false` or restart worker |
| WebSocket not connecting | Session cookie not forwarded | Ensure `credentials: include` in browser fetch + check CORS |
| CORS error | Frontend origin not whitelisted | Add to gateway `CORS_ORIGIN` env var |
| Role change not propagating | RBAC cache not expired | Wait 5 min or flush Redis cache manually |

### Kafka Consumer Reset

```bash
docker exec iacms-kafka kafka-consumer-groups \
  --bootstrap-server localhost:29092 \
  --group notification-service \
  --reset-offsets --to-latest --all-topics --execute
```

### Redis RBAC Cache Flush

```bash
# Flush all RBAC caches
docker exec iacms-redis redis-cli KEYS "rbac:perms:*" | \
  xargs docker exec -i iacms-redis redis-cli DEL

# Flush for a specific user
docker exec iacms-redis redis-cli DEL "rbac:perms:{userId}:{tenantId}"
```

### Database Backup

```bash
docker exec iacms-postgres pg_dump -U postgres iacms > iacms_backup_$(date +%Y%m%d).sql
```

### Log Inspection

```bash
docker compose logs -f api-gateway            # Gateway + outbox/webhook workers
docker compose logs -f iam-service            # Auth + RBAC + Tenant management
docker compose logs -f case-engine-service    # Case + Workflow + Referral
docker compose logs -f notification-service   # Email delivery events
docker compose logs -f file-service           # Upload pipeline
docker compose logs -f file-service-workers   # Background processing
docker compose logs -f chat-service           # Messaging + WebSocket
```

---

> *This document covers the IACMS platform as of the Post-Microservices-Restructure release, November 2026.*  
> *The OAuth2/OIDC integration system is under active development and is intentionally excluded from this document.*
