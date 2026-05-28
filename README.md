# IACMS — Inter-Agency Case Management System

A **multi-tenant microservices** backend for managing cases across government organizations.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | Express.js 5.x |
| Database | PostgreSQL 15 |
| ORM | Prisma 6.x |
| Sessions | Redis (`iacms:sess:*` keys, API Gateway) |
| Events | Apache Kafka |
| Containerization | Docker & Docker Compose |

---

## Services

| Service | Port | Responsibility |
|---------|------|---------------|
| API Gateway | 3000 | Single entry point, auth, routing |
| Auth Service | 3001 | Login, register, JWT tokens |
| RBAC Service | 3002 | Roles, permissions |
| Case Service | 3003 | Case CRUD, assignments |
| Workflow Service | 3004 | Workflow definitions, state transitions |
| Referral Service | 3005 | Inter-organization referrals |
| Audit Service | 3006 | Immutable audit logging |
| Integration Service | 3007 | Webhooks, external integrations |
| Notification Service | 3008 | Event-driven notifications |

---

## Project Structure

```
IACMS/
├── services/                  # All microservices
│   ├── api-gateway/
│   ├── auth-service/
│   ├── rbac-service/
│   ├── case-service/
│   ├── workflow-service/
│   ├── referral-service/
│   ├── audit-service/
│   ├── integration-service/
│   └── notification-service/
├── shared/                    # Code shared across services
│   ├── common/                # Logger, error classes
│   ├── middleware/            # Error handler
│   └── utils/                 # EventBus (Kafka), HTTP client
├── infrastructure/
│   └── docker-compose.yml     # All Docker services
├── prisma/                    # Database schema & migrations
├── docs/                      # Technical documentation
│   ├── DOCUMENTATION.md       # Full technical reference
│   ├── SESSION_AUTHENTICATION.md
│   ├── KAFKA_INTEGRATION.md
│   └── session-auth-flow.png
└── IACMS_Auth_Postman_Collection.json
```

---

## Quick Start (Local Development)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [Node.js 20+](https://nodejs.org/)
- [Postman](https://www.postman.com/) (for testing)

### 1. Start Infrastructure

```powershell
cd infrastructure
docker-compose up -d postgres zookeeper kafka
```

Verify containers are healthy:
```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Expected output:
```
NAMES             STATUS              PORTS
iacms-postgres    Up (healthy)        0.0.0.0:5433->5432/tcp
iacms-zookeeper   Up (healthy)        0.0.0.0:2181->2181/tcp
iacms-kafka       Up (healthy)        0.0.0.0:9092->9092/tcp
```

### 2. Run Database Migrations

```powershell
cd ..
npx prisma migrate deploy
npx prisma db seed
```

### 3. Start Services

Open separate terminals for each service:

```powershell
# Terminal 1 - Auth Service
cd services/auth-service
npm start

# Terminal 2 - API Gateway
cd services/api-gateway
npm start
```

### 4. Verify Everything Works

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/health"
```

Expected:
```json
{ "status": "ok", "features": { "sessionAuth": true, "jwtAuth": true } }
```

---

## Authentication

The system supports **two authentication methods**:

### Session Auth (Web Browsers)
```
POST /api/v1/session/login    → sets iacms.sid cookie
GET  /api/v1/session/status   → check session
POST /api/v1/session/logout   → destroy session
POST /api/v1/session/refresh  → extend session
```

### JWT Auth (API / Mobile)
```
POST /api/v1/auth/login       → returns accessToken + refreshToken
POST /api/v1/auth/register    → create account
GET  /api/v1/auth/profile     → get profile (Bearer token required)
POST /api/v1/auth/refresh     → get new access token
```

---

## API Endpoints (via Gateway on port 3000)

```
POST   /api/v1/auth/login
POST   /api/v1/auth/register
GET    /api/v1/auth/profile

POST   /api/v1/session/login
POST   /api/v1/session/logout
GET    /api/v1/session/status
POST   /api/v1/session/refresh

GET    /api/v1/cases
POST   /api/v1/cases
GET    /api/v1/cases/:id

GET    /api/v1/rbac/roles
POST   /api/v1/rbac/user-roles/assign

GET    /api/v1/workflows
GET    /api/v1/referrals
GET    /api/v1/audit
GET    /api/v1/integrations
GET    /api/v1/notifications
```

---

## Testing with Postman

Import the collection: `IACMS_Auth_Postman_Collection.json`

Test credentials:
```json
{
  "email": "admin@test-org.com",
  "password": "password123",
  "tenantCode": "TEST-ORG"
}
```

---

## Common Commands

### Docker

```powershell
# Start infrastructure only
cd infrastructure
docker-compose up -d postgres zookeeper kafka

# Start all services (including microservices via Docker)
docker-compose up -d

# Stop everything
docker-compose down

# Stop and delete all data
docker-compose down -v

# View logs
docker-compose logs -f kafka
```

### Database

```powershell
# Run migrations
npx prisma migrate deploy

# Seed test data
npx prisma db seed

# Open database GUI
npx prisma studio

# Connect to database directly
docker exec -it iacms-postgres psql -U postgres -d iacms
```

### Kafka

```powershell
# List topics (shows after first event is published)
docker exec iacms-kafka kafka-topics --bootstrap-server localhost:9092 --list

# Watch events in real time
docker exec iacms-kafka kafka-console-consumer --bootstrap-server localhost:9092 --topic case.created --from-beginning
```

---

## Environment Variables

### Root `.env`
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms?schema=public
KAFKA_BROKERS=localhost:9092
```

### `services/auth-service/.env`
```env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms?schema=public
JWT_SECRET=iacms-dev-secret-key-change-in-production
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
KAFKA_BROKERS=localhost:9092
```

### `services/api-gateway/.env`
```env
PORT=3000
AUTH_SERVICE_URL=http://localhost:3001
SESSION_SECRET=iacms-session-secret-change-in-production
SESSION_MAX_AGE=86400
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms
CORS_ORIGIN=http://localhost:5173
KAFKA_BROKERS=localhost:9092
```

---

## Run on your LAN (network / IP access)

Other devices on the same network reach services via your machine’s LAN IP (not `localhost`).

### Option A — all backend services in Docker (recommended)

1. Generate `infrastructure/.env` (CORS, Kafka, email links):

```bash
npm run network:env
# or: cd infrastructure && ./setup-network-env.sh
```

2. Start everything:

```bash
cd infrastructure
docker compose up -d
```

3. From the repo root, migrate/seed if this is a fresh DB:

```bash
npx prisma migrate deploy
npx prisma db seed
```

4. Frontend (in `../client` or your client folder):

```bash
# client/.env — use your LAN IP from setup-network-env.sh
VITE_API_URL=http://192.168.x.x:3000

npm run dev -- --host
```

Open `http://<your-lan-ip>:5173` on any device on the LAN. API gateway: `http://<your-lan-ip>:3000/health`.

Published ports (all bind on `0.0.0.0` on the host):

| Service | Port |
|---------|------|
| API Gateway | 3000 |
| Auth | 3001 |
| RBAC | 3002 |
| Case | 3003 |
| Workflow | 3004 |
| Referral | 3005 |
| Audit | 3006 |
| Integration | 3007 |
| Notification | 3008 |
| Postgres | 5433 |
| Redis | 6379 |
| Kafka | 9092 |

The UI only needs the gateway (`3000`). Individual service ports are for debugging or direct API calls.

### Option B — infrastructure in Docker, microservices with `npm start`

1. Start infra only:

```bash
npm run docker:up
```

2. In `services/api-gateway/.env`, add your LAN origin to CORS (comma-separated):

```env
CORS_ORIGIN=http://192.168.x.x:5173,http://localhost:5173
```

3. Start each service in its own terminal (`npm start` or `npm run dev` in `services/*`). Node listens on all interfaces by default.

4. Set `VITE_API_URL=http://192.168.x.x:3000` and run the client with `--host` as above.

### Firewall

Allow inbound TCP on the ports you use (at least `3000` and `5173`).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Docker not starting | Open Docker Desktop, wait for engine to fully start |
| `iacms-postgres` name conflict | `docker rm iacms-postgres` then re-run docker-compose |
| Database auth failed | Check `DATABASE_URL` port is `5433` not `5432` |
| Kafka not connecting | Wait ~30s after starting, Kafka takes time to initialize |
| Session not persisting | Ensure `credentials: 'include'` in frontend fetch calls |
| CORS error | Set `CORS_ORIGIN` to your frontend URL |

---

## Documentation

All detailed technical documentation is in `docs/DOCUMENTATION.md`:

- Architecture deep-dive
- Database schema (all 15 tables)
- Session authentication internals
- Kafka event streaming
- Development setup guide
- API reference
