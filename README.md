# IACMS - Inter-Agency Case Management Platform

**Microservices Architecture** - Backend API for the Inter-Agency Case Management Platform, a multi-tenant system for managing cases across government organizations.

## 🏗️ Architecture

This project uses a **microservices architecture** with 9 independent services:

- **API Gateway** - Single entry point for all requests
- **Auth Service** - Authentication and authorization
- **RBAC Service** - Role-based access control
- **Case Service** - Case management
- **Workflow Service** - Workflow engine
- **Referral Service** - Inter-organization referrals
- **Audit Service** - Audit logging
- **Integration Service** - External integrations and webhooks
- **Notification Service** - Event-driven notifications

## 📁 Project Structure

```
IACMS/
├── services/              # Microservices
│   ├── api-gateway/
│   ├── auth-service/
│   ├── rbac-service/
│   ├── case-service/
│   ├── workflow-service/
│   ├── referral-service/
│   ├── audit-service/
│   ├── integration-service/
│   └── notification-service/
├── shared/                 # Shared utilities
│   ├── common/            # Logger, errors
│   ├── middleware/        # Error handler
│   └── utils/             # HTTP client, event bus
├── infrastructure/         # Infrastructure configs
│   └── docker-compose.yml
├── prisma/                # Original schema (reference documentation)
└── docs/                  # Documentation
```

## 🚀 Quick Start

### Using Docker Compose (Recommended)

```bash
# Start all services
cd infrastructure
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Local Development

1. **Start infrastructure:**
   ```bash
   cd infrastructure
   docker-compose up -d postgres redis
   ```

2. **Install dependencies:**
   ```bash
   cd services/auth-service && npm install && cd ../..
   cd services/case-service && npm install && cd ../..
   # ... repeat for each service
   ```

3. **Run migrations:**
   ```bash
   cd services/auth-service && npm run migrate
   ```

4. **Start services:**
   ```bash
   # Terminal 1 - API Gateway
   cd services/api-gateway && npm run dev

   # Terminal 2 - Auth Service
   cd services/auth-service && npm run dev

   # Terminal 3 - Case Service
   cd services/case-service && npm run dev
   ```

## 📡 API Endpoints

All requests go through the API Gateway at `http://localhost:3000`:

### Authentication
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/register` - User registration
- `GET /api/v1/auth/profile` - Get user profile

### Cases
- `GET /api/v1/cases` - List cases
- `POST /api/v1/cases` - Create case
- `GET /api/v1/cases/:id` - Get case

### RBAC
- `GET /api/v1/rbac/roles` - List roles
- `POST /api/v1/rbac/user-roles/assign` - Assign role

### Other Services
- `GET /api/v1/workflows` - List workflows
- `GET /api/v1/referrals` - List referrals
- `GET /api/v1/audit` - Get audit logs

## 🔧 Technology Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js 5.x
- **Database**: PostgreSQL 15
- **ORM**: Prisma 6.0
- **Cache/Events**: Redis
- **Containerization**: Docker & Docker Compose
- **Language**: JavaScript (ES Modules)

## 📚 Documentation

- **[Microservices Guide](./MICROSERVICES_README.md)** - Complete microservices documentation
- **[Database Schema](./docs/DATABASE_SCHEMA.md)** - Database schema documentation
- **[Database Detailed](./docs/DATABASE_DETAILED.md)** - Detailed database guide

## 🔐 Features

- ✅ Multi-tenant architecture with tenant isolation
- ✅ Role-based access control (RBAC)
- ✅ Configurable workflow engine
- ✅ Case management with assignment and escalation
- ✅ Inter-organization case referrals
- ✅ Immutable audit logging
- ✅ RESTful APIs for external integrations
- ✅ Webhook system for event notifications
- ✅ Event-driven architecture

## 🛠️ Development

### Service Ports

- API Gateway: `3000`
- Auth Service: `3001`
- RBAC Service: `3002`
- Case Service: `3003`
- Workflow Service: `3004`
- Referral Service: `3005`
- Audit Service: `3006`
- Integration Service: `3007`
- Notification Service: `3008`

### Health Checks

Each service has a health endpoint:
```bash
curl http://localhost:3001/health  # Auth Service
curl http://localhost:3003/health  # Case Service
```

### Environment Variables

Each service has its own `.env` file. See service directories for examples.

Common variables:
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `JWT_SECRET` - JWT secret (Auth Service)
- `PORT` - Service port

## 📦 Services Overview

### API Gateway
- Routes requests to appropriate services
- Single entry point
- Request/response transformation

### Auth Service
- User authentication (login, register)
- JWT token generation
- Tenant validation
- User profile management

### RBAC Service
- Role management
- Permission management
- User-role assignments
- Permission checks

### Case Service
- Case CRUD operations
- Case assignments
- File attachments
- Case status management

### Workflow Service
- Workflow definitions
- State transitions
- Workflow execution

### Referral Service
- Inter-organization referrals
- Referral status tracking
- Cross-tenant access

### Audit Service
- Immutable audit logging
- Audit queries
- Compliance reporting

### Integration Service
- Webhook management
- External system integrations
- Data synchronization

### Notification Service
- Event-driven notifications
- Email/SMS notifications
- Real-time notifications

## 🔄 Service Communication

### Synchronous (HTTP/REST)
- API Gateway → Services
- Service-to-service calls (when needed)

### Asynchronous (Events)
- Redis Pub/Sub for events
- Event-driven architecture
- Loose coupling between services

## 🐳 Docker

All services are containerized and can be run with Docker Compose:

```bash
# Build all services
docker-compose build

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f <service-name>

# Restart a service
docker-compose restart <service-name>
```

## 📝 Development Status

The microservices architecture is fully structured. Remaining work:

1. Complete service implementations
2. Add authentication middleware to API Gateway
3. Implement all event handlers
4. Add comprehensive tests
5. Set up monitoring and logging

## 🤝 Contributing

1. Each service is independent
2. Follow the service structure
3. Use shared utilities from `shared/`
4. Publish events for cross-service communication
5. Write tests for each service

## 📄 License

ISC

---

For detailed microservices documentation, see [MICROSERVICES_README.md](./MICROSERVICES_README.md)
