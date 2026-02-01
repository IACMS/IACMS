# Tools and Prerequisites for IACMS Phase 1

This document lists all the tools, technologies, and knowledge you should have to successfully complete the Phase 1 implementation plan.

---

## Essential Development Tools

### 1. **Node.js & Package Management**
- **Node.js 20+** (LTS version recommended)
  - Download: https://nodejs.org/
  - Check version: `node --version`
- **npm** (comes with Node.js)
  - Check version: `npm --version`
- **Why**: Runtime for all microservices

### 2. **Docker & Docker Compose**
- **Docker Desktop** (includes Docker Compose)
  - Windows: https://www.docker.com/products/docker-desktop
  - Check: `docker --version`
  - Check: `docker-compose --version`
- **Why**: Containerization and local infrastructure (PostgreSQL, Redis)

### 3. **Database Tools**
- **PostgreSQL Client** (optional but helpful)
  - pgAdmin: https://www.pgadmin.org/
  - DBeaver: https://dbeaver.io/
  - Or use VS Code extension: "PostgreSQL" by Chris Kolkman
- **Why**: View database, run queries, debug issues

### 4. **Code Editor**
- **Visual Studio Code** (recommended)
  - Download: https://code.visualstudio.com/
  - Must-have extensions:
    - ESLint
    - Prettier - Code formatter
    - Prisma
    - Docker
    - REST Client (for testing APIs)
- **Why**: Primary development environment

### 5. **API Testing Tools**
- **Postman** (recommended)
  - Download: https://www.postman.com/downloads/
- **Alternative**: Thunder Client (VS Code extension)
- **Alternative**: curl (command line)
- **Why**: Test API endpoints, debug requests/responses

### 6. **Git & Version Control**
- **Git** for Windows
  - Download: https://git-scm.com/download/win
  - Check: `git --version`
- **GitHub Desktop** (optional, if you prefer GUI)
- **Why**: Version control and collaboration

---

## Required Technical Knowledge

### Programming & Frameworks

#### **JavaScript (ES6+)**
**Must Know:**
- ✅ Async/await, Promises
- ✅ Arrow functions
- ✅ Destructuring
- ✅ Template literals
- ✅ Modules (import/export)
- ✅ Spread/rest operators

**Resources:**
- MDN Web Docs: https://developer.mozilla.org/en-US/docs/Web/JavaScript
- JavaScript.info: https://javascript.info/

#### **Node.js**
**Must Know:**
- ✅ Creating HTTP servers
- ✅ Working with environment variables (.env)
- ✅ File system operations
- ✅ npm package management

**Resources:**
- Node.js Docs: https://nodejs.org/docs/

#### **Express.js 5.x**
**Must Know:**
- ✅ Routing (GET, POST, PUT, DELETE)
- ✅ Middleware (request processing)
- ✅ Error handling
- ✅ Request/response objects
- ✅ JSON parsing

**Resources:**
- Express Docs: https://expressjs.com/

#### **Prisma ORM**
**Must Know:**
- ✅ Schema definition
- ✅ Migrations (`prisma migrate dev`)
- ✅ CRUD operations (findMany, create, update, delete)
- ✅ Relations (include, select)
- ✅ Where clauses and filtering

**Resources:**
- Prisma Docs: https://www.prisma.io/docs/

### Database

#### **PostgreSQL**
**Must Know:**
- ✅ Basic SQL (SELECT, INSERT, UPDATE, DELETE)
- ✅ WHERE clauses
- ✅ JOINs (basic understanding)
- ✅ Data types (UUID, JSONB, timestamps)
- ✅ Indexes (basic understanding)

**Resources:**
- PostgreSQL Tutorial: https://www.postgresqltutorial.com/

#### **Redis**
**Must Know:**
- ✅ Basic concepts (key-value store)
- ✅ Pub/Sub pattern (for event bus)
- ✅ Connection basics

**You don't need deep Redis knowledge** - the EventBus utility handles most of it.

### Architecture & Design

#### **Microservices Architecture**
**Must Understand:**
- ✅ Service independence
- ✅ API Gateway pattern
- ✅ Service-to-service communication
- ✅ Event-driven architecture (Pub/Sub)
- ✅ Database per service concept

**Resources:**
- Microservices.io: https://microservices.io/

#### **RESTful APIs**
**Must Know:**
- ✅ HTTP methods (GET, POST, PUT, DELETE)
- ✅ Status codes (200, 201, 400, 401, 404, 500)
- ✅ Request/response format (JSON)
- ✅ Authentication (JWT)
- ✅ API versioning (/api/v1/)

#### **JWT (JSON Web Tokens)**
**Must Understand:**
- ✅ Token structure (header.payload.signature)
- ✅ Token generation and verification
- ✅ Storing user info in payload
- ✅ Token expiration

**Resources:**
- JWT.io: https://jwt.io/introduction

#### **Multi-Tenancy**
**Must Understand:**
- ✅ Tenant isolation concept
- ✅ Tenant ID in database records
- ✅ Filtering by tenant automatically
- ✅ Cross-tenant security

### Docker & Containerization

#### **Docker Basics**
**Must Know:**
- ✅ What containers are
- ✅ Dockerfile structure
- ✅ Building images: `docker build`
- ✅ Running containers: `docker run`
- ✅ Viewing logs: `docker logs`

#### **Docker Compose**
**Must Know:**
- ✅ YAML syntax (basic)
- ✅ Starting services: `docker-compose up`
- ✅ Stopping services: `docker-compose down`
- ✅ Viewing logs: `docker-compose logs -f`
- ✅ Rebuilding: `docker-compose up --build`

**Resources:**
- Docker Getting Started: https://docs.docker.com/get-started/

---

## Development Environment Setup

### Quick Setup Checklist

```bash
# 1. Install Node.js 20+
node --version  # Should show v20.x.x or higher

# 2. Install Docker Desktop
docker --version
docker-compose --version

# 3. Clone/navigate to project
cd C:\Users\zbook\Desktop\IACMS

# 4. Start infrastructure
cd infrastructure
docker-compose up -d postgres redis

# 5. Install dependencies for a service
cd ../services/auth-service
npm install

# 6. Run database migrations
npm run migrate

# 7. Start service
npm run dev
```

---

## Helpful npm Packages (Already in project)

### Core Dependencies
- **express**: Web framework
- **@prisma/client**: Database ORM
- **bcryptjs**: Password hashing
- **jsonwebtoken**: JWT creation/verification
- **ioredis**: Redis client
- **dotenv**: Environment variables
- **http-proxy-middleware**: API Gateway routing
- **cors**: Cross-origin requests

### Development Tools
- **prisma**: Database toolkit CLI
- **eslint**: Code linting
- **prettier**: Code formatting

---

## Learning Path (If you're new to any technology)

### Priority 1 (Critical for Phase 1)
1. **JavaScript ES6+** (1-2 days if completely new)
2. **Express.js basics** (1 day)
3. **Prisma ORM** (1 day)
4. **Docker basics** (1 day)

### Priority 2 (Important)
5. **JWT authentication** (few hours)
6. **REST API design** (few hours)
7. **PostgreSQL basics** (1 day)

### Priority 3 (Learn as you go)
8. **Microservices patterns**
9. **Redis Pub/Sub**
10. **Multi-tenancy concepts**

---

## Recommended VS Code Extensions

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "prisma.prisma",
    "ms-azuretools.vscode-docker",
    "humao.rest-client",
    "ckolkman.vscode-postgres",
    "christian-kohler.path-intellisense",
    "streetsidesoftware.code-spell-checker"
  ]
}
```

Save this as `.vscode/extensions.json` in your project.

---

## Testing Tools (for Day 8)

### Jest
- **What**: JavaScript testing framework
- **Install**: `npm install --save-dev jest supertest`
- **Why**: Write automated tests
- **Learn**: https://jestjs.io/docs/getting-started

### Supertest
- **What**: HTTP assertion library
- **Why**: Test API endpoints
- **Learn**: https://github.com/ladjs/supertest

---

## Debugging Tools

### VS Code Debugger
1. Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Auth Service",
      "program": "${workspaceFolder}/services/auth-service/src/server.js",
      "cwd": "${workspaceFolder}/services/auth-service",
      "envFile": "${workspaceFolder}/services/auth-service/.env"
    }
  ]
}
```

### Chrome DevTools for Node
```bash
node --inspect src/server.js
# Then open chrome://inspect in Chrome
```

---

## Common Commands Reference

### Docker Commands
```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f [service-name]

# Restart a service
docker-compose restart [service-name]

# Remove all containers and volumes
docker-compose down -v

# Rebuild and start
docker-compose up -d --build
```

### Prisma Commands
```bash
# Generate Prisma Client
npm run prisma:generate

# Create and apply migration
npm run migrate

# Apply migrations (production)
npm run migrate:deploy

# Open Prisma Studio (database GUI)
npx prisma studio
```

### npm Commands
```bash
# Install dependencies
npm install

# Start in development (with auto-reload)
npm run dev

# Start in production
npm start

# Run tests
npm test
```

---

## Troubleshooting Resources

### When Stuck
1. **Check logs**: `docker-compose logs -f [service]`
2. **Check database**: Use pgAdmin or `npx prisma studio`
3. **Check Redis**: Use RedisInsight (optional tool)
4. **Test API**: Use Postman or REST Client
5. **Read error stack traces** carefully

### Common Issues
- **Port already in use**: Change port in `.env` file
- **Database connection failed**: Check `DATABASE_URL` in `.env`
- **Migration failed**: Check Prisma schema syntax
- **Cannot authenticate**: Check JWT_SECRET is same across services

---

## Documentation to Bookmark

### Official Docs
- Node.js: https://nodejs.org/docs/
- Express: https://expressjs.com/
- Prisma: https://www.prisma.io/docs/
- PostgreSQL: https://www.postgresql.org/docs/
- Docker: https://docs.docker.com/
- Redis: https://redis.io/docs/

### Tutorials
- REST API Tutorial: https://restfulapi.net/
- JWT Tutorial: https://jwt.io/introduction
- Microservices: https://microservices.io/patterns/

---

## Optional But Helpful Tools

### Database GUI
- **Prisma Studio**: `npx prisma studio` (built-in)
- **pgAdmin**: Full PostgreSQL GUI
- **DBeaver**: Universal database tool

### Redis GUI
- **RedisInsight**: https://redis.com/redis-enterprise/redis-insight/
- **Another Redis Desktop Manager**

### API Documentation
- **Swagger Editor**: https://editor.swagger.io/
- **Postman**: Built-in documentation

### Monitoring (Phase 5)
- **Docker Desktop**: Built-in container monitoring
- **Portainer**: Docker GUI management

---

## Time Investment Estimate

### If you're experienced with Node.js:
- **Setup time**: 2-4 hours
- **Learning curve**: Minimal
- **Ready to start**: Day 1

### If you're new to Node.js:
- **Setup time**: 4-8 hours
- **Learning curve**: 1-2 weeks (parallel with development)
- **Recommendation**: Start with tutorials, then jump into project

### If you're completely new to backend development:
- **Setup time**: 8-16 hours
- **Learning curve**: 3-4 weeks
- **Recommendation**: Complete a Node.js + Express course first

---

## Next Steps

1. ✅ Install all essential tools (Node.js, Docker, VS Code, Postman)
2. ✅ Verify installations with version checks
3. ✅ Read through PHASE1_IMPLEMENTATION_PLAN.md
4. ✅ Set up VS Code extensions
5. ✅ Clone/open project in VS Code
6. ✅ Start with Day 1 tasks

**Ready to begin? Start with Day 1 of the implementation plan!**
