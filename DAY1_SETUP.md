# Day 1: Database Setup & Auth Service - Quick Start Guide

This guide walks you through setting up the IACMS development environment.

## Prerequisites

- **Docker Desktop** installed and running
- **Node.js 20+** installed
- **Git** (optional, for version control)

## Step 1: Start Database Infrastructure

Open a terminal in the project root folder and run:

```bash
# Start PostgreSQL and Redis containers
cd infrastructure
docker-compose up -d postgres redis
```

Wait for containers to be healthy (about 10-15 seconds):

```bash
# Check container status
docker-compose ps
```

You should see both `iacms-postgres` and `iacms-redis` with status "healthy".

## Step 2: Install Dependencies

```bash
# Go back to project root
cd ..

# Install root dependencies (for Prisma)
npm install

# Install auth-service dependencies
cd services/auth-service
npm install
cd ../..
```

## Step 3: Run Database Migrations

```bash
# Deploy the database schema
npx prisma migrate deploy
```

This creates all 15 tables in the database.

## Step 4: Seed the Database

```bash
# Run the seed script
npm run db:seed
```

This creates:
- 1 test tenant (TEST-ORG)
- 3 system roles (admin, case_manager, viewer)
- 22 permissions
- 3 test users (one per role)
- 1 default workflow

## Step 5: Start the Auth Service

```bash
cd services/auth-service
npm run dev
```

The service will start on **http://localhost:3001**

## Step 6: Test the API

### Health Check

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "auth-service",
  "timestamp": "2026-02-01T..."
}
```

### Login

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test-org.com",
    "password": "password123",
    "tenantCode": "TEST-ORG"
  }'
```

Expected response:
```json
{
  "user": {
    "id": "22222222-2222-2222-2222-222222222222",
    "email": "admin@test-org.com",
    "firstName": "Admin",
    "lastName": "User",
    "tenant": {
      "id": "11111111-1111-1111-1111-111111111111",
      "name": "Test Organization",
      "code": "TEST-ORG"
    }
  },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

### Register New User

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@test-org.com",
    "password": "password123",
    "firstName": "New",
    "lastName": "User",
    "tenantId": "11111111-1111-1111-1111-111111111111"
  }'
```

### Get Profile (requires token)

```bash
curl http://localhost:3001/auth/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Test Credentials

| User | Email | Password | Role |
|------|-------|----------|------|
| Admin | admin@test-org.com | password123 | admin (all permissions) |
| Case Manager | manager@test-org.com | password123 | case_manager |
| Viewer | viewer@test-org.com | password123 | viewer (read-only) |

**Tenant Code**: `TEST-ORG`

---

## Quick Commands Reference

```bash
# Start infrastructure
npm run docker:up

# Stop infrastructure
npm run docker:down

# Run migrations
npm run prisma:migrate

# Seed database
npm run db:seed

# Reset database (drops all data)
npm run db:reset

# Open Prisma Studio (database GUI)
npm run prisma:studio

# Start auth service
cd services/auth-service && npm run dev
```

---

## Troubleshooting

### Docker containers not starting
```bash
# Check Docker is running
docker info

# Restart Docker Desktop if needed
```

### Database connection errors
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Check connection
docker exec -it iacms-postgres psql -U postgres -d iacms -c "SELECT 1"
```

### Port already in use
```bash
# Find process using port 3001
netstat -ano | findstr :3001

# Kill the process (Windows)
taskkill /PID <PID> /F
```

### Migration errors
```bash
# Reset and re-run migrations
npx prisma migrate reset --force
npm run db:seed
```

---

## Next Steps

After completing Day 1:

1. ✅ Database running with seed data
2. ✅ Auth Service functional (login/register working)
3. ✅ Can authenticate and get JWT token

Continue to **Day 2**: API Gateway & Request Authentication
