# IACMS Microservices Architecture

This project has been restructured from a monolithic application into a microservices architecture.

## Architecture Overview

The IACMS platform is now split into 9 independent microservices:

1. **API Gateway** (Port 3000) - Single entry point, request routing
2. **Auth Service** (Port 3001) - Authentication, JWT tokens, tenant management
3. **RBAC Service** (Port 3002) - Role-based access control
4. **Case Service** (Port 3003) - Case management, assignments, attachments
5. **Workflow Service** (Port 3004) - Workflow definitions and state transitions
6. **Referral Service** (Port 3005) - Inter-organization case referrals
7. **Audit Service** (Port 3006) - Immutable audit logging
8. **Integration Service** (Port 3007) - Webhooks and external integrations
9. **Notification Service** (Port 3008) - Event-driven notifications

## Project Structure

```
iacms/
├── services/
│   ├── api-gateway/          # API Gateway service
│   ├── auth-service/          # Authentication service
│   ├── rbac-service/          # RBAC service
│   ├── case-service/          # Case management service
│   ├── workflow-service/      # Workflow service
│   ├── referral-service/     # Referral service
│   ├── audit-service/         # Audit service
│   ├── integration-service/   # Integration service
│   └── notification-service/  # Notification service
├── shared/                    # Shared utilities
│   ├── common/                # Common utilities (logger, errors)
│   ├── middleware/            # Shared middleware
│   └── utils/                  # Shared utilities (HTTP client, event bus)
├── infrastructure/
│   ├── docker-compose.yml     # Docker Compose configuration
│   └── kubernetes/            # Kubernetes manifests (future)
└── docs/                      # Documentation
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- PostgreSQL 15+ (or use Docker)
- Redis (or use Docker)

### Running with Docker Compose

1. **Start all services:**
   ```bash
   cd infrastructure
   docker-compose up -d
   ```

2. **View logs:**
   ```bash
   docker-compose logs -f
   ```

3. **Stop all services:**
   ```bash
   docker-compose down
   ```

4. **Rebuild services:**
   ```bash
   docker-compose up -d --build
   ```

### Running Locally (Development)

1. **Start infrastructure:**
   ```bash
   cd infrastructure
   docker-compose up -d postgres redis
   ```

2. **Install dependencies for each service:**
   ```bash
   cd services/auth-service && npm install && cd ../..
   cd services/rbac-service && npm install && cd ../..
   # ... repeat for each service
   ```

3. **Run database migrations:**
   ```bash
   cd services/auth-service && npm run migrate
   cd ../rbac-service && npm run migrate
   # ... repeat for each service with Prisma
   ```

4. **Start services individually:**
   ```bash
   # Terminal 1
   cd services/api-gateway && npm run dev

   # Terminal 2
   cd services/auth-service && npm run dev

   # Terminal 3
   cd services/case-service && npm run dev
   # ... etc
   ```

## API Endpoints

All API requests go through the API Gateway at `http://localhost:3000`:

- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/register` - User registration
- `GET /api/v1/auth/profile` - Get user profile
- `GET /api/v1/cases` - List cases
- `POST /api/v1/cases` - Create case
- `GET /api/v1/rbac/roles` - List roles
- `GET /api/v1/workflows` - List workflows
- `GET /api/v1/referrals` - List referrals
- `GET /api/v1/audit` - Get audit logs
- `GET /api/v1/integrations` - List integrations
- `GET /api/v1/notifications` - Get notifications

## Service Communication

### Synchronous (HTTP/REST)
- API Gateway routes requests to appropriate services
- Services can call each other via HTTP (when needed)

### Asynchronous (Event-Driven)
- Services communicate via Redis Pub/Sub
- Events are published to the event bus
- Services subscribe to relevant events

### Example Events:
- `user.created` - Published when a user is created
- `case.created` - Published when a case is created
- `case.assigned` - Published when a case is assigned
- `audit.log` - Published for audit logging

## Database Strategy

Currently, all services share the same PostgreSQL database but use different Prisma schemas. Each service only accesses its own tables:

- **Auth Service**: `tenants`, `users`
- **RBAC Service**: `roles`, `permissions`, `role_permissions`, `user_roles`
- **Case Service**: `cases`, `assignments`, `case_attachments`
- **Workflow Service**: `workflows`, `workflow_states`
- **Referral Service**: `case_referrals`
- **Audit Service**: `audit_logs`
- **Integration Service**: `webhooks`, `integrations`

**Future**: Migrate to database-per-service for better isolation.

## Environment Variables

Each service has its own environment variables. See `.env.example` files in each service directory.

Common variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - JWT secret key (Auth Service)
- `PORT` - Service port number

## Development Workflow

1. **Make changes** to a service
2. **Test locally** by running the service
3. **Rebuild Docker image** if needed: `docker-compose build <service-name>`
4. **Restart service**: `docker-compose restart <service-name>`

## Monitoring

- Health checks: `GET /health` on each service
- Logs: `docker-compose logs -f <service-name>`
- Database: Connect to `localhost:5432`
- Redis: Connect to `localhost:6379`

## Next Steps

1. **Implement remaining service logic** (controllers, services)
2. **Add authentication middleware** to API Gateway
3. **Implement event handlers** in each service
4. **Add service discovery** (Consul or Kubernetes)
5. **Set up monitoring** (Prometheus, Grafana)
6. **Add API documentation** (Swagger/OpenAPI)
7. **Implement database-per-service** migration
8. **Add Kubernetes manifests** for production deployment

## Troubleshooting

### Service won't start
- Check logs: `docker-compose logs <service-name>`
- Verify database connection
- Check environment variables

### Database connection errors
- Ensure PostgreSQL is running: `docker-compose ps postgres`
- Check `DATABASE_URL` environment variable
- Run migrations: `npm run migrate` in service directory

### Port conflicts
- Change port in service's `.env` file
- Update `docker-compose.yml` port mapping
- Update API Gateway service URLs

## Development Status

The microservices architecture is fully structured and the monolithic code has been removed. To complete the implementation:

1. Complete service implementations
2. Move shared business logic to appropriate services
3. Update API clients to use new endpoints
4. Add comprehensive testing
5. Set up monitoring and logging

