# IACMS Technical Documentation

> Complete technical reference for the Inter-Agency Case Management System.  
> For quick-start and project overview, see [`README.md`](../README.md).

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Services Reference](#2-services-reference)
3. [Authentication](#3-authentication)
4. [Database Schema](#4-database-schema)
5. [Event Bus (Kafka)](#5-event-bus-kafka)
6. [Prisma ORM](#6-prisma-orm)
7. [API Reference](#7-api-reference)
8. [Development Setup](#8-development-setup)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Architecture

### System Overview

```
                        ┌───────────────────────────────────┐
  Web Browser ─────────▶│         API Gateway :3000          │
  Mobile/API  ─────────▶│  (Auth · RBAC · Proxy · Sessions) │
                        └──────────────┬────────────────────┘
                                       │ HTTP Proxy
         ┌─────────────────────────────┼───────────────────────────────┐
         │                             │                               │
         ▼                             ▼                               ▼
  ┌─────────────┐           ┌──────────────────┐            ┌──────────────────┐
  │ Auth Service│           │  Case / Workflow  │            │ RBAC / Referral  │
  │   :3001     │           │  Services :3003-4 │            │ Services :3002,5 │
  └─────────────┘           └──────────────────┘            └──────────────────┘
         │                             │                               │
         └──────────────────┬──────────┘───────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │         PostgreSQL         │
              │  (data + user_sessions)   │
              └───────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │       Apache Kafka         │
              │  (inter-service events)   │
              └───────────────────────────┘
                     │              │
        ┌────────────┘              └──────────────┐
        ▼                                          ▼
 ┌──────────────┐                        ┌──────────────────┐
 │ Notification │                        │  Audit Service   │
 │ Service :3008│                        │    :3006         │
 └──────────────┘                        └──────────────────┘
```

### Communication Patterns

| Pattern | Technology | Use Case |
|---------|-----------|---------|
| Synchronous | HTTP REST (via proxy) | Client → API Gateway → Service |
| Asynchronous | Kafka events | Service → Service notifications |

### Infrastructure Services (Docker)

| Container | Port | Purpose |
|-----------|------|---------|
| `iacms-postgres` | 5433 | Primary database + session storage |
| `iacms-zookeeper` | 2181 | Kafka cluster management |
| `iacms-kafka` | 9092 (host) / 29092 (internal) | Event message broker |

---

## 2. Services Reference

### API Gateway (`services/api-gateway`, port 3000)

The single entry point for all external traffic. Responsibilities:

- **Authentication middleware** — validates session cookie OR JWT Bearer token
- **RBAC middleware** — checks permissions against RBAC Service
- **Reverse proxy** — routes requests to downstream services via `http-proxy-middleware`
- **Session management** — creates, stores, and destroys sessions in PostgreSQL

Key files:

| File | Purpose |
|------|---------|
| `src/server.js` | Express app setup, middleware pipeline |
| `src/config/session.config.js` | PostgreSQL session store configuration |
| `src/middleware/auth.middleware.js` | Dual auth (session + JWT) |
| `src/middleware/rbac.middleware.js` | Permission checks |
| `src/controllers/session.controller.js` | Session login/logout/status/refresh |
| `src/routes/session.routes.js` | Session route definitions |

### Auth Service (`services/auth-service`, port 3001)

Handles all identity operations. Not called by users directly — always proxied via API Gateway.

- User login (validates credentials, issues JWT access + refresh tokens)
- User registration (creates user, validates tenant)
- JWT token refresh
- User profile management
- Password change

Key files:

| File | Purpose |
|------|---------|
| `src/controllers/auth.controller.js` | Login, register, refresh, profile |
| `src/utils/validators.js` | Input validation (email, password, tenantCode/tenantId) |
| `src/middleware/auth.middleware.js` | JWT verification middleware |
| `prisma/schema.prisma` | Manages `users` and `tenants` tables |

### RBAC Service (`services/rbac-service`, port 3002)

Role-Based Access Control. Manages who can do what.

- Role CRUD
- Permission CRUD
- User-role assignments
- Permission lookup: `GET /permissions/user/:userId`
- Permission check: `GET /permissions/check/:userId?resource=x&action=y`

### Case Service (`services/case-service`, port 3003)

Core business logic: case lifecycle management.

- Create, view, update, close cases
- Assign cases to users
- Case status transitions
- File attachment management

### Workflow Service (`services/workflow-service`, port 3004)

State machine for cases.

- Define workflow templates (states + transitions)
- Execute state transitions
- Track transition history in `workflow_states`

### Referral Service (`services/referral-service`, port 3005)

Cross-organization case referrals.

- Submit referrals between tenants
- Accept / reject referrals
- Track referral status

### Audit Service (`services/audit-service`, port 3006)

Immutable audit trail. Subscribes to Kafka events and writes to `audit_logs`.

- `audit.log` topic subscriber
- Compliance reporting endpoints

### Integration Service (`services/integration-service`, port 3007)

External system connectivity.

- Webhook management
- External API integrations
- Manual sync triggers

### Notification Service (`services/notification-service`, port 3008)

Event-driven notifications. Subscribes to Kafka events.

- Subscribes to `user.created`, `case.assigned`, `referral.*` events
- Sends email / SMS notifications (implementation-specific)

---

## 3. Authentication

### Dual Authentication Strategy

The API Gateway supports two authentication mechanisms simultaneously:

| Method | Client Type | Transport | Session Store |
|--------|------------|-----------|--------------|
| Session (cookie) | Web browsers | `iacms.sid` HttpOnly cookie | PostgreSQL `user_sessions` |
| JWT (token) | Mobile apps, API clients | `Authorization: Bearer <token>` | Stateless (no storage) |

The auth middleware checks **session first**, then falls back to JWT:

```
Incoming request
       │
       ▼
Is req.session.user set?  ──YES──▶  Attach user to request, continue
       │
      NO
       │
       ▼
Is Authorization: Bearer present?  ──YES──▶  Verify JWT, continue
       │
      NO
       │
       ▼
Is the route public?  ──YES──▶  Allow through
       │
      NO
       │
       ▼
401 Unauthorized
```

### Session Authentication

**Flow: Login**

```
Browser  →  POST /api/v1/session/login (email, password, tenantCode)
         ←  Set-Cookie: iacms.sid=... (HttpOnly, SameSite=Lax)

Browser  →  GET /api/v1/cases (Cookie: iacms.sid=...)
         ←  Cases data
```

**Session endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/session/login` | Log in, create session |
| `POST` | `/api/v1/session/logout` | Destroy session |
| `GET` | `/api/v1/session/status` | Check active session |
| `POST` | `/api/v1/session/refresh` | Extend session expiry |

**PostgreSQL session table:**

```sql
CREATE TABLE "user_sessions" (
  "sid"    VARCHAR    NOT NULL PRIMARY KEY,
  "sess"   JSON       NOT NULL,
  "expire" TIMESTAMP  NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "user_sessions" ("expire");
```

`sess` stores:
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "tenantId": "uuid",
    "firstName": "Jane",
    "lastName": "Doe",
    "roles": ["admin"]
  },
  "loginTime": "2026-01-01T00:00:00.000Z",
  "lastAccessed": "2026-01-01T01:00:00.000Z"
}
```

**Session configuration** (`services/api-gateway/src/config/session.config.js`):

| Setting | Value | Reason |
|---------|-------|--------|
| `name` | `iacms.sid` | Custom name (hides framework) |
| `httpOnly` | `true` | JS cannot read this cookie (XSS protection) |
| `sameSite` | `lax` | CSRF protection |
| `secure` | `false` (dev) / `true` (prod) | HTTPS-only in production |
| `maxAge` | 86400s (24h) | Session lifetime |
| `rolling` | `true` | Expiry resets on every active request |
| `resave` | `false` | No unnecessary DB writes |
| `saveUninitialized` | `false` | No empty sessions for guests |

### JWT Authentication

**Flow: Login**

```
Client  →  POST /api/v1/auth/login (email, password, tenantCode)
        ←  { accessToken: "...", refreshToken: "..." }

Client  →  GET /api/v1/cases
           Authorization: Bearer <accessToken>
        ←  Cases data
```

**JWT endpoints:**

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| `POST` | `/api/v1/auth/login` | No | Get access + refresh tokens |
| `POST` | `/api/v1/auth/register` | No | Create new user |
| `GET` | `/api/v1/auth/profile` | Yes | Get current user profile |
| `POST` | `/api/v1/auth/refresh` | No | Exchange refresh token for new access token |
| `POST` | `/api/v1/auth/logout` | Yes | Invalidate refresh token |

**Token lifetimes:**

| Token | Lifetime | Purpose |
|-------|---------|---------|
| Access Token | 24h | Short-lived, used for API calls |
| Refresh Token | 7 days | Long-lived, used only to get new access tokens |

**JWT payload:**

```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "tenantId": "uuid",
  "roles": ["admin"],
  "iat": 1700000000,
  "exp": 1700086400
}
```

### What the Auth Service vs API Gateway Each Do

This is a common point of confusion:

| Responsibility | API Gateway | Auth Service |
|---------------|------------|-------------|
| Validate JWT on requests | Yes — reads and verifies token | No |
| Issue JWT tokens | No | Yes — after verifying credentials |
| Store sessions | Yes — PostgreSQL `user_sessions` | No |
| Check passwords | No | Yes — bcrypt comparison |
| Check tenant exists | No | Yes — Prisma query |
| Forward user identity to services | Yes — via `x-user-id` header | No |

In short: **Auth Service proves identity**, **API Gateway enforces it**.

---

## 4. Database Schema

### Multi-Tenancy

Every tenant-aware table has a `tenant_id` column. PostgreSQL Row Level Security (RLS) automatically filters all queries so users only ever see their own tenant's data.

The tenant context is set before each request:

```javascript
await prisma.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}`;
```

### Tables

#### Core

**`tenants`** — Organizations using the system

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `name` | String | Organization name |
| `code` | String UNIQUE | Short code, e.g. `POLICE`, `COURTS` |
| `config` | JSONB | Tenant-specific config |
| `is_active` | Boolean | |
| `created_at`, `updated_at` | Timestamp | |

**`users`** — User accounts

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `tenant_id` | UUID FK → tenants | |
| `email` | String UNIQUE (per tenant) | |
| `username` | String UNIQUE (per tenant) | |
| `password_hash` | String | bcrypt hash |
| `first_name`, `last_name` | String | |
| `phone`, `national_id` | String nullable | |
| `is_active`, `is_email_verified` | Boolean | |
| `last_login` | Timestamp nullable | |
| `created_at`, `updated_at` | Timestamp | |

#### RBAC

**`roles`** — Role definitions

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `tenant_id` | UUID FK nullable | NULL = system-wide role |
| `name` | String | e.g. `case_officer`, `supervisor` |
| `description` | Text | |
| `is_system_role` | Boolean | Cannot be deleted |
| `is_active` | Boolean | |

**`permissions`** — Permission definitions (system-wide)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `resource` | String | e.g. `cases`, `workflows` |
| `action` | String | e.g. `create`, `read`, `update`, `delete` |
| `description` | Text | |

**`role_permissions`** — Links roles ↔ permissions (junction table)

**`user_roles`** — Links users ↔ roles (junction table)

| Column | Type | Description |
|--------|------|-------------|
| `expires_at` | Timestamp nullable | For temporary assignments |

#### Case Management

**`cases`** — Core case records

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `tenant_id` | UUID FK | Owning tenant |
| `originating_tenant_id` | UUID FK nullable | Tenant that created the case |
| `current_tenant_id` | UUID FK nullable | Tenant currently handling it |
| `case_number` | String UNIQUE | Format: `ORG-YYYY-XXXXX` |
| `title` | String | |
| `type` | String | `criminal`, `civil`, etc. |
| `priority` | String | `low`, `normal`, `high`, `urgent` |
| `status` | String | Current status |
| `workflow_id` | UUID FK nullable | Active workflow |
| `assigned_to` | UUID FK nullable | Assigned user |
| `due_date` | Timestamp nullable | SLA deadline |
| `resolved_at` | Timestamp nullable | |
| `deleted_at` | Timestamp nullable | Soft delete |

RLS: User can see a case if their tenant owns it, originated it, is currently handling it, or has an active referral.

**`workflows`** — Workflow templates per tenant

**`workflow_states`** — State transition history per case

**`assignments`** — Case assignment history

**`case_attachments`** — File attachments linked to cases

**`case_referrals`** — Inter-organization referrals

| Column | Type | Description |
|--------|------|-------------|
| `from_tenant_id` | UUID FK | Referring org |
| `to_tenant_id` | UUID FK | Receiving org |
| `status` | String | `pending`, `accepted`, `rejected`, `completed`, `cancelled` |

#### Audit & Integration

**`audit_logs`** — Immutable audit trail (never update or delete)

| Column | Type | Description |
|--------|------|-------------|
| `entity_type` | String | `case`, `user`, `workflow`, etc. |
| `entity_id` | UUID | ID of the audited object |
| `action` | String | `create`, `update`, `delete`, `view` |
| `old_values`, `new_values` | JSONB nullable | Before/after state |

**`webhooks`** — Webhook subscriptions

**`integrations`** — External system integrations

**`user_sessions`** — Session store (created by API Gateway, not Prisma)

### RLS Patterns

```sql
-- Standard tenant isolation policy
CREATE POLICY tenant_isolation_cases ON cases
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Super admin bypass (use with extreme caution)
SET LOCAL app.is_super_admin = true;
```

---

## 5. Event Bus (Kafka)

### Why Kafka

| Feature | Redis Pub/Sub (replaced) | Kafka (current) |
|---------|------------------------|-----------------|
| Message persistence | No (lost if consumer is down) | Yes (disk storage) |
| Replay missed events | Impossible | Built-in |
| Guaranteed delivery | No | Yes |
| Consumer groups | No | Yes |
| Message ordering | No | Per-partition |

### Infrastructure

```yaml
# infrastructure/docker-compose.yml

zookeeper:
  image: confluentinc/cp-zookeeper:7.5.0
  port: 2181

kafka:
  image: confluentinc/cp-kafka:7.5.0
  ports:
    - "9092:9092"      # Host access (your code / Postman)
    - "29092:29092"    # Internal Docker network
```

### Topics

| Topic | Published By | Consumed By |
|-------|-------------|-------------|
| `user.created` | auth-service | notification-service |
| `user.updated` | auth-service | — |
| `case.created` | case-service | notification-service, audit-service |
| `case.updated` | case-service | audit-service |
| `case.assigned` | case-service | notification-service, audit-service |
| `workflow.created` | workflow-service | audit-service |
| `workflow.updated` | workflow-service | audit-service |
| `workflow.state.changed` | workflow-service | notification-service, audit-service |
| `referral.created` | referral-service | notification-service, audit-service |
| `referral.accepted` | referral-service | notification-service |
| `referral.rejected` | referral-service | notification-service |
| `integration.created` | integration-service | audit-service |
| `integration.updated` | integration-service | audit-service |
| `webhook.created` | integration-service | audit-service |
| `webhook.updated` | integration-service | audit-service |
| `audit.log` | any service | audit-service |

### EventBus API

All services use `shared/utils/eventBus.js`:

```javascript
import EventBus, { TOPICS } from '../../../shared/utils/eventBus.js';

// Initialize (once per service)
const eventBus = new EventBus(
  process.env.KAFKA_BROKERS || 'localhost:9092',
  'case-service'   // Used as consumer group ID
);

// Publish an event
await eventBus.publish(TOPICS.CASE_CREATED, {
  caseId: newCase.id,
  tenantId: newCase.tenantId,
});

// Subscribe to events
await eventBus.subscribe(TOPICS.CASE_CREATED, (data) => {
  console.log('New case:', data.caseId);
});

// Graceful shutdown
await eventBus.close();
```

### Message Format

Every Kafka message envelope:

```json
{
  "type": "case.created",
  "data": {
    "caseId": "uuid",
    "tenantId": "uuid"
  },
  "timestamp": "2026-02-01T10:00:00.000Z",
  "serviceId": "case-service"
}
```

Your `subscribe` handler receives only the `data` field.

### Consumer Groups

Each service registers its own consumer group (its service name). This means:
- Multiple instances of the same service share load — only one processes each message
- Different services each get their own independent copy of every message

### Fault Tolerance

- **Service down:** Messages accumulate in Kafka. When the service restarts, it catches up.
- **Kafka down:** `publish()` fails silently with a warning log — service continues working.
- **New subscribers:** Use `fromBeginning: false` (default), so they only process events after startup.

### CLI Monitoring

```powershell
# List all topics
docker exec iacms-kafka kafka-topics --bootstrap-server localhost:9092 --list

# Watch messages in real time
docker exec iacms-kafka kafka-console-consumer `
  --bootstrap-server localhost:9092 `
  --topic case.created `
  --from-beginning

# Describe a topic
docker exec iacms-kafka kafka-topics `
  --bootstrap-server localhost:9092 `
  --describe `
  --topic case.created
```

---

## 6. Prisma ORM

All services that access the database use Prisma. The schema is at `prisma/schema.prisma`.

### Commands

```powershell
# Generate Prisma Client (run after any schema change)
npm run prisma:generate      # or: npx prisma generate

# Create and apply a new migration
npm run migrate              # or: npx prisma migrate dev --name <description>

# Apply migrations (production/staging)
npm run migrate:deploy       # or: npx prisma migrate deploy

# Seed the database with test data
npm run db:seed              # or: npx prisma db seed

# Open the Prisma Studio database GUI
npx prisma studio            # Opens at http://localhost:5555

# Validate schema
npx prisma validate

# Format schema file
npx prisma format
```

### Common Query Patterns

```javascript
import prisma from '../config/database.js';

// Find by ID
const user = await prisma.user.findUnique({
  where: { id: userId }
});

// Find with relations
const caseWithDetails = await prisma.case.findUnique({
  where: { id: caseId },
  include: {
    tenant: true,
    creator: true,
    assignee: true,
    workflow: true,
    attachments: { where: { deletedAt: null } }
  }
});

// Create with relations
const newUser = await prisma.user.create({
  data: {
    email,
    passwordHash,
    firstName,
    lastName,
    tenant: { connect: { id: tenantId } }
  }
});

// Soft delete
await prisma.case.update({
  where: { id: caseId },
  data: { deletedAt: new Date() }
});

// Transaction
const [user, auditLog] = await prisma.$transaction([
  prisma.user.create({ data: userData }),
  prisma.auditLog.create({ data: auditData })
]);
```

### Row Level Security with Prisma

Set tenant context before any query in a request:

```javascript
// In middleware/tenant.js
await prisma.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}::uuid`;
await prisma.$executeRaw`SET LOCAL app.current_user_id = ${userId}::uuid`;
```

After this, all Prisma queries in that request automatically respect RLS.

---

## 7. API Reference

All requests go through the API Gateway at `http://localhost:3000`.

### Authentication Endpoints

#### Session Auth (web browsers)

```
POST /api/v1/session/login
Body: { "email": "...", "password": "...", "tenantCode": "TEST-ORG" }
Response: { "success": true, "user": { ... } }
Cookie: iacms.sid=... (set automatically)

POST /api/v1/session/logout
Cookie: iacms.sid=...
Response: { "success": true }

GET /api/v1/session/status
Cookie: iacms.sid=...
Response: { "authenticated": true, "user": { ... } }

POST /api/v1/session/refresh
Cookie: iacms.sid=...
Response: { "success": true, "expiresAt": "..." }
```

#### JWT Auth (API clients)

```
POST /api/v1/auth/login
Body: { "email": "...", "password": "...", "tenantCode": "TEST-ORG" }
Response: { "accessToken": "...", "refreshToken": "..." }

POST /api/v1/auth/register
Body: {
  "email": "...",
  "password": "...",
  "firstName": "...",
  "lastName": "...",
  "username": "...",
  "tenantCode": "TEST-ORG"
}
Response: { "user": { ... }, "accessToken": "...", "refreshToken": "..." }

GET /api/v1/auth/profile
Authorization: Bearer <accessToken>
Response: { "user": { ... } }

POST /api/v1/auth/refresh
Body: { "refreshToken": "..." }
Response: { "accessToken": "..." }
```

### Case Endpoints

```
GET  /api/v1/cases              List cases (paginated)
POST /api/v1/cases              Create a case
GET  /api/v1/cases/:id          Get case detail
PUT  /api/v1/cases/:id          Update case
DELETE /api/v1/cases/:id        Soft-delete case
```

### RBAC Endpoints

```
GET  /api/v1/rbac/roles                   List roles
POST /api/v1/rbac/roles                   Create role
GET  /api/v1/rbac/permissions             List permissions
POST /api/v1/rbac/user-roles/assign       Assign role to user
GET  /api/v1/rbac/permissions/user/:id    Get user's permissions
GET  /api/v1/rbac/permissions/check/:id   Check permission
  ?resource=cases&action=create
```

### Health Checks

```
GET /health                     API Gateway health
GET /api/v1/auth/health         Auth Service health
```

### Headers Forwarded by Gateway

When a request is authenticated (session or JWT), the gateway adds these headers before proxying to downstream services:

| Header | Value |
|--------|-------|
| `x-user-id` | Authenticated user's UUID |
| `x-tenant-id` | User's tenant UUID |
| `x-user-email` | User's email |
| `x-user-roles` | Comma-separated roles |

Services should read user identity from these headers, not re-validate tokens.

---

## 8. Development Setup

### Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 20+ | `node --version` |
| Docker Desktop | Latest | `docker --version` |
| Postman | Latest | (optional, for testing) |

### First-Time Setup

**1. Start infrastructure containers:**

```powershell
cd infrastructure
docker-compose up -d postgres zookeeper kafka
```

Wait ~30 seconds for Kafka to initialize, then verify:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}"
```

**2. Install dependencies:**

```powershell
# Root (Prisma + shared tools)
cd ..
npm install

# Each service you want to run
cd services/auth-service && npm install && cd ../..
cd services/api-gateway && npm install && cd ../..
```

**3. Run database migrations:**

```powershell
npx prisma migrate deploy
```

**4. Seed test data:**

```powershell
npx prisma db seed
```

This creates:
- Tenant: `TEST-ORG`
- 3 roles: `Admin`, `Case Manager`, `Viewer`
- Test users for each role

**5. Start services:**

```powershell
# Terminal 1
cd services/auth-service
npm start

# Terminal 2
cd services/api-gateway
npm start
```

### Service Ports Reference

| Service | Port |
|---------|------|
| API Gateway | 3000 |
| Auth Service | 3001 |
| RBAC Service | 3002 |
| Case Service | 3003 |
| Workflow Service | 3004 |
| Referral Service | 3005 |
| Audit Service | 3006 |
| Integration Service | 3007 |
| Notification Service | 3008 |
| PostgreSQL | 5433 |
| Zookeeper | 2181 |
| Kafka | 9092 |

### Environment Variables

Copy `.env.example` (if present) or create `.env` in each service directory.

**`services/auth-service/.env`**

```env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms?schema=public
JWT_SECRET=iacms-dev-secret-key-change-in-production
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
KAFKA_BROKERS=localhost:9092
NODE_ENV=development
```

**`services/api-gateway/.env`**

```env
PORT=3000
AUTH_SERVICE_URL=http://localhost:3001
RBAC_SERVICE_URL=http://localhost:3002
CASE_SERVICE_URL=http://localhost:3003
WORKFLOW_SERVICE_URL=http://localhost:3004
REFERRAL_SERVICE_URL=http://localhost:3005
AUDIT_SERVICE_URL=http://localhost:3006
INTEGRATION_SERVICE_URL=http://localhost:3007
NOTIFICATION_SERVICE_URL=http://localhost:3008
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms
SESSION_SECRET=iacms-session-secret-change-in-production
SESSION_MAX_AGE=86400
CORS_ORIGIN=http://localhost:5173
KAFKA_BROKERS=localhost:9092
NODE_ENV=development
```

### Running Tests

```powershell
# All services (from root)
npm test

# Single service
cd services/auth-service
npm test
```

### VS Code Extensions (Recommended)

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "prisma.prisma",
    "ms-azuretools.vscode-docker",
    "humao.rest-client",
    "ckolkman.vscode-postgres"
  ]
}
```

Save as `.vscode/extensions.json` to share with the team.

### VS Code Debugger Config

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Auth Service",
      "program": "${workspaceFolder}/services/auth-service/src/server.js",
      "cwd": "${workspaceFolder}/services/auth-service",
      "envFile": "${workspaceFolder}/services/auth-service/.env"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "API Gateway",
      "program": "${workspaceFolder}/services/api-gateway/src/server.js",
      "cwd": "${workspaceFolder}/services/api-gateway",
      "envFile": "${workspaceFolder}/services/api-gateway/.env"
    }
  ]
}
```

---

## 9. Troubleshooting

### Docker Issues

**Problem:** `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`  
**Fix:** Docker Desktop is not running. Open Docker Desktop and wait for the engine to fully start.

**Problem:** `Error response from daemon: Conflict. The container name "/iacms-postgres" is already in use`  
**Fix:**
```powershell
docker rm iacms-postgres
cd infrastructure && docker-compose up -d postgres
```

**Problem:** Zookeeper shows unhealthy with `ruok is not executed because it is not in the whitelist`  
**Fix:** Already fixed in `docker-compose.yml` via `KAFKA_OPTS: "-Dzookeeper.4lw.commands.whitelist=ruok,stat,mntr"`.  
If still occurring: `docker-compose down && docker-compose up -d zookeeper kafka`

### Database Issues

**Problem:** `Authentication failed against database server`  
**Fix:** Ensure your `DATABASE_URL` uses port `5433` not `5432`:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms?schema=public
```

**Problem:** `Prisma Client not found` or `P1001: Can't reach database`  
**Fix:**
```powershell
# Regenerate client
npx prisma generate

# Verify PostgreSQL is running
docker ps --filter "name=iacms-postgres"
```

**Problem:** `EPERM: operation not permitted` when running `prisma generate`  
**Fix:** Node processes are locking Prisma files. Kill them first:
```powershell
taskkill /F /IM node.exe
npx prisma generate
```

### Authentication Issues

**Problem:** `tenant-id is required` when registering  
**Fix:** Use `tenantCode` (string like `"TEST-ORG"`) in the request body, not `tenantId` (UUID).

**Problem:** Session cookie not sent on subsequent requests  
**Fix:** Frontend must use `credentials: 'include'` on all fetch calls:
```javascript
fetch('http://localhost:3000/api/v1/session/status', {
  credentials: 'include'
});
```

**Problem:** CORS error in browser  
**Fix:** Set `CORS_ORIGIN` in `api-gateway/.env` to match your frontend URL exactly:
```env
CORS_ORIGIN=http://localhost:5173
```

### Kafka Issues

**Problem:** Service logs `Failed to connect to Kafka event bus`  
**Fix:** Kafka takes 30–60 seconds to fully initialize. This warning is expected during startup and the service continues to work without Kafka. Kafka will be available shortly.

**Problem:** No topics visible with `kafka-topics --list`  
**Fix:** Topics are auto-created on first `publish()` call. Start a service that publishes events (e.g., log in through auth-service) and topics will appear.

### Common npm Commands

```powershell
# Install all service dependencies at once (from root)
npm run install:all

# Start all Docker infrastructure
npm run docker:up

# Stop all Docker infrastructure
npm run docker:down
```
