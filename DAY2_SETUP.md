# Day 2: API Gateway & Request Authentication

## What Was Implemented

### 1. JWT Authentication Middleware
- Location: `services/api-gateway/src/middleware/auth.middleware.js`
- Validates JWT tokens on all protected routes
- Extracts user information (id, tenantId, email) from token
- Forwards user info to downstream services via headers
- Public routes bypass authentication

### 2. RBAC Middleware
- Location: `services/api-gateway/src/middleware/rbac.middleware.js`
- Checks user permissions before allowing access to resources
- Route-to-permission mapping for all protected endpoints
- In-memory permission caching (5-minute TTL)
- Integrates with RBAC Service for permission lookup

### 3. Request Routing/Proxy
- All API requests route through single entry point (port 3000)
- Path rewriting for downstream services
- User context forwarding via custom headers

### 4. RBAC Service Permission Endpoints
- `GET /permissions/user/:userId` - Get all user permissions
- `GET /permissions/check/:userId?resource=x&action=y` - Check specific permission

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway (3000)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Auth MW    │→ │   RBAC MW    │→ │   Proxy Middleware   │  │
│  │ (JWT verify) │  │ (permission) │  │  (route to service)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
    ┌────────────────────────┼────────────────────────────────┐
    │                        │                                │
    ▼                        ▼                                ▼
┌──────────┐          ┌──────────┐                     ┌──────────┐
│   Auth   │          │   RBAC   │                     │  Other   │
│ Service  │          │ Service  │                     │ Services │
│  (3001)  │          │  (3002)  │                     │ (3003+)  │
└──────────┘          └──────────┘                     └──────────┘
```

## Public Routes (No Authentication Required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | User login |
| POST | `/api/v1/auth/register` | User registration |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| GET | `/api/v1/tenants/validate/:code` | Validate tenant code |
| GET | `/health` | Gateway health check |

## Protected Routes & Permissions

| Method | Path Pattern | Required Permission |
|--------|--------------|---------------------|
| GET | `/api/v1/cases` | `cases:read` |
| POST | `/api/v1/cases` | `cases:create` |
| PUT | `/api/v1/cases/:id` | `cases:update` |
| DELETE | `/api/v1/cases/:id` | `cases:delete` |
| POST | `/api/v1/cases/:id/assign` | `cases:assign` |
| GET | `/api/v1/rbac/roles` | `roles:read` |
| POST | `/api/v1/rbac/roles` | `roles:create` |
| GET | `/api/v1/workflows` | `workflows:read` |
| GET | `/api/v1/audit` | `audit:read` |

## Quick Start

### Prerequisites
- Day 1 completed (Docker, database, auth-service running)

### Start Services

```bash
# Terminal 1: Auth Service
cd services/auth-service
npm run dev

# Terminal 2: RBAC Service
cd services/rbac-service
npm run dev

# Terminal 3: API Gateway
cd services/api-gateway
npm run dev
```

### Test Endpoints

```bash
# 1. Test gateway health
curl http://localhost:3000/health

# 2. Login via gateway (public route)
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test-org.com","password":"password123","tenantCode":"TEST-ORG"}'

# 3. Access protected endpoint with token
curl http://localhost:3000/api/v1/auth/profile \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. Access RBAC service
curl http://localhost:3000/api/v1/rbac/roles \
  -H "Authorization: Bearer YOUR_TOKEN"

# 5. Get user permissions
curl http://localhost:3000/api/v1/rbac/permissions/user/USER_ID \
  -H "Authorization: Bearer YOUR_TOKEN"

# 6. Test without token (should return 401)
curl http://localhost:3000/api/v1/rbac/roles
```

## Service Configuration

### API Gateway `.env`
```env
PORT=3000
JWT_SECRET=iacms-dev-secret-key-change-in-production
AUTH_SERVICE_URL=http://localhost:3001
RBAC_SERVICE_URL=http://localhost:3002
# ... other service URLs
```

### Auth Service `.env`
```env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms?schema=public
JWT_SECRET=iacms-dev-secret-key-change-in-production
```

### RBAC Service `.env`
```env
PORT=3002
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms?schema=public
```

## Headers Forwarded to Services

When a request passes through the API Gateway, these headers are added:

| Header | Description |
|--------|-------------|
| `x-user-id` | Authenticated user's ID |
| `x-tenant-id` | User's tenant ID |
| `x-user-email` | User's email address |

## Troubleshooting

### "UNAUTHORIZED: Authentication token required"
- Ensure you're including the `Authorization: Bearer <token>` header
- Check that the route isn't in the public routes list

### "INVALID_TOKEN: Invalid authentication token"
- Token may be expired (default 24h)
- JWT_SECRET mismatch between services - ensure all services use the same secret

### "FORBIDDEN: You don't have permission"
- User lacks the required permission for this resource
- Check user's roles and permissions via `/api/v1/rbac/permissions/user/:userId`

### Service Unavailable (503)
- Downstream service may not be running
- Check that all required services are started

## Files Created/Modified

### New Files
- `services/api-gateway/src/middleware/auth.middleware.js`
- `services/api-gateway/src/middleware/rbac.middleware.js`
- `services/api-gateway/.env`
- `services/rbac-service/.env`

### Modified Files
- `services/api-gateway/src/server.js` - Added auth/RBAC middleware
- `services/api-gateway/package.json` - Added jsonwebtoken dependency
- `services/rbac-service/src/controllers/permission.controller.js` - Added user permissions endpoint
- `services/rbac-service/src/routes/permission.routes.js` - Added new routes
- Various import path fixes across services

## Next Steps (Day 3)

- Implement Case Service with CRUD operations
- Add database queries for case management
- Integrate with workflow service for case status transitions
