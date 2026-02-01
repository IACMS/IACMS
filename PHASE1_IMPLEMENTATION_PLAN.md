# IACMS Phase 1: 2-Week MVP Implementation Plan

## Project Overview

**IACMS (Inter-Agency Case Management System)** is a large-scale microservices platform for managing cases across government organizations. This is **Phase 1** - establishing a solid foundation with core features working end-to-end.

> **Important**: This is a **huge project** that will take months to complete fully. This 2-week plan focuses on building a **working MVP** with essential features to demonstrate the system and provide a foundation for future phases.

**Current State:**
- ✅ 9 microservices scaffolded with basic structure
- ✅ Database schema complete (15 tables)
- ✅ Docker Compose infrastructure ready
- ✅ Shared utilities (EventBus, HttpClient, Logger, Error Handler)
- ⚠️ Controllers partially implemented
- ❌ No tests
- ❌ Authentication middleware incomplete
- ❌ Event handlers not implemented
- ❌ Database migrations not run

## Phase 1 Goals (2 Weeks)

**Primary Objective**: Build a **functional MVP** that demonstrates:
1. ✅ User authentication and authorization
2. ✅ Basic case lifecycle (create, view, update, assign, close)
3. ✅ Simple workflow execution
4. ✅ Audit logging
5. ✅ Working deployment with Docker

**Out of Scope for Phase 1** (Future phases):
- ❌ Cross-tenant referrals
- ❌ Complex workflow engine
- ❌ File attachments
- ❌ Webhooks and integrations
- ❌ Notifications
- ❌ Advanced RBAC features
- ❌ Comprehensive testing (only smoke tests)
- ❌ Production hardening

---

## Week 1: Foundation & Core Services (Days 1-5)

### Day 1: Database Setup & Authentication Service

#### Focus: Get the database running and authentication working

**Tasks:**

**1. Database Infrastructure** (3 hours)
- Start PostgreSQL and Redis via Docker Compose
- Run Prisma migrations for Auth Service
- Create seed script for initial data:
  - 1 test tenant (code: "TEST-ORG")
  - 3 system roles: Admin, Case Manager, Viewer
  - 1 test user per role
- Verify all tables created correctly

**2. Auth Service - Complete Core Features** (5 hours)
- ✅ Already working: login, register, token generation
- Test login/register flows
- Fix any bugs in existing code
- Add basic input validation
- Document API endpoints

**Deliverables:**
- ✅ Database running with seed data
- ✅ Auth Service functional (login/register working)
- ✅ Can authenticate and get JWT token

**Skip for Phase 1**: Password reset, email verification, token blacklisting

---

### Day 2: API Gateway & Request Authentication

#### Focus: Protect all routes with authentication

**Tasks:**

**1. API Gateway Authentication Middleware** (6 hours)
- Install `jwt` verification dependencies
- Create middleware to validate JWT tokens
- Extract user and tenant from token
- Add middleware to all routes (except `/auth/login`, `/auth/register`)
- Test protected routes return 401 without token

**2. Basic RBAC Middleware** (2 hours)
- Create simple permission check middleware
- Store user roles in JWT payload
- Add role-based route protection (e.g., only Admin can create users)

**Deliverables:**
- ✅ All API routes protected with authentication
- ✅ Unauthorized requests rejected
- ✅ User context available in all requests

**Skip for Phase 1**: Advanced RBAC, permission caching, role hierarchy

---

### Day 3-4: Case Service - Core CRUD Operations

#### Focus: Create, read, update cases with basic workflow

**Tasks:**

**1. Run Case Service Migrations** (1 hour)
- Run Prisma migrations for Case Service tables
- Verify `cases`, `workflow_states`, `assignments` tables created

**2. Case Service Implementation** (10 hours)
- **Create Case**: 
  - Accept title, description, type, priority
  - Generate case number (format: `ORG-2026-00001`)
  - Set status to "open"
  - Assign to creator initially
- **List Cases**: 
  - Filter by tenant (automatic via tenant context)
  - Filter by status, type, assignedTo (query params)
  - Return cases with assignee info
- **Get Case by ID**: Return full case details
- **Update Case**: 
  - Update title, description, priority
  - Change status (open → in_progress → resolved → closed)
  - Reassign to different user
- **Soft Delete**: Set `deletedAt` timestamp

**3. Basic Workflow** (3 hours)
- Create simple workflow: `open → in_progress → resolved → closed`
- Create `WorkflowState` record when status changes
- Validate state transitions (e.g., can't go from open to closed directly)

**4. Testing** (2 hours)
- Test all CRUD operations via Postman/curl
- Test with different tenants (data isolation)
- Document test scenarios

**Deliverables:**
- ✅ Full case CRUD working
- ✅ Cases filtered by tenant automatically
- ✅ Basic status workflow enforced
- ✅ Case assignment working

**Skip for Phase 1**: File attachments, advanced workflows, SLA tracking, search

---

### Day 5: Audit Service & Basic Event Integration

#### Focus: Log all important actions for compliance

**Tasks:**

**1. Audit Service Setup** (2 hours)
- Run Prisma migrations for Audit Service
- Verify `audit_logs` table created

**2. Audit Logging Implementation** (4 hours)
- Create audit log creation endpoint
- Log these events:
  - User login
  - Case created
  - Case updated
  - Case assigned
  - Case status changed
- Store: user_id, tenant_id, action, entity_type, entity_id, old/new values

**3. Event Bus Integration** (4 hours)
- Auth Service: Publish `user.logged_in` event
- Case Service: Publish `case.created`, `case.updated`, `case.assigned` events
- Audit Service: Subscribe to all events and create audit logs
- Test event flow works

**4. Query Audit Logs** (2 hours)
- Create endpoint to get audit logs
- Filter by tenant, entity_type, date range
- Test audit trail is complete

**Deliverables:**
- ✅ All major actions logged to audit table
- ✅ Event bus connecting services
- ✅ Can query audit history

**Skip for Phase 1**: Retention policies, compliance reports, advanced filtering

---

## Week 2: Integration, Documentation & Deployment (Days 6-10)

### Day 6-7: RBAC Service & User Management

#### Focus: Complete role-based access control

**Tasks:**

**1. RBAC Service Setup** (2 hours)
- Run Prisma migrations for RBAC tables
- Verify `roles`, `permissions`, `role_permissions`, `user_roles` created

**2. Role & Permission Management** (6 hours)
- Create endpoints:
  - List roles (tenant-specific + system roles)
  - Create role (tenant-specific)
  - Assign permissions to role
  - Assign role to user
- Seed default permissions:
  - `cases:create`, `cases:read`, `cases:update`, `cases:delete`
  - `cases:assign`, `cases:close`
- Map roles to permissions:
  - **Admin**: All permissions
  - **Case Manager**: create, read, update, assign
  - **Viewer**: read only

**3. Permission Check Endpoint** (3 hours)
- Create `/rbac/check` endpoint
- Input: userId, resource, action
- Return: allowed (true/false)
- Use in API Gateway middleware

**4. Integration with API Gateway** (3 hours)
- Update authentication middleware to load user roles
- Add permission checks to case routes
- Test: Viewer cannot create cases, Case Manager can

**Deliverables:**
- ✅ Role and permission management working
- ✅ Permission checks enforced on API Gateway
- ✅ Users have appropriate access based on roles

**Skip for Phase 1**: Role hierarchy, permission caching, bulk operations

---

### Day 8: Basic Testing & Bug Fixes

#### Focus: Ensure core flows work reliably

**Tasks:**

**1. Manual Testing** (4 hours)
- Test complete user flow:
  1. Register user
  2. Login
  3. Create case
  4. Assign case to another user
  5. Update case status
  6. View audit logs
- Test with 2 different tenants (data isolation)
- Document bugs found

**2. Bug Fixes** (4 hours)
- Fix any critical bugs from testing
- Add missing validation
- Improve error messages

**3. Basic Automated Tests** (4 hours)
- Set up Jest testing framework
- Write smoke tests:
  - Auth: login returns token
  - Cases: create case returns ID
  - Cases: list cases returns array
  - RBAC: permission check works
- Target: **10 basic tests passing**

**Deliverables:**
- ✅ Complete user flow working end-to-end
- ✅ Multi-tenant data isolation verified
- ✅ Critical bugs fixed
- ✅ Basic test suite passing

**Skip for Phase 1**: Comprehensive test coverage, integration tests, load testing

---

### Day 9: API Documentation & Developer Setup

#### Focus: Make it easy for others to use the system

**Tasks:**

**1. API Documentation** (4 hours)
- Create `API.md` documenting all endpoints:
  - **Auth**: `/auth/register`, `/auth/login`
  - **Cases**: `GET/POST/PUT/DELETE /cases`
  - **RBAC**: `/rbac/roles`, `/rbac/permissions`, `/rbac/check`
  - **Audit**: `GET /audit`
- Include request/response examples
- Document error codes

**2. Postman Collection** (2 hours)
- Create collection with all endpoints
- Add example requests
- Add environment variables (BASE_URL, TOKEN)
- Export and commit to repo

**3. Setup Documentation** (3 hours)
- Update README.md with:
  - Quick start guide
  - Prerequisites
  - Installation steps
  - Running with Docker
  - Seed data credentials
- Create `ARCHITECTURE.md` with:
  - System diagram
  - Service responsibilities
  - Database schema overview

**4. Environment Setup** (3 hours)
- Create `.env.example` for each service
- Document all environment variables
- Create setup script to copy `.env.example` to `.env`

**Deliverables:**
- ✅ Complete API documentation
- ✅ Postman collection ready to use
- ✅ Clear setup instructions
- ✅ Architecture documented

**Skip for Phase 1**: Swagger/OpenAPI, auto-generated docs, video tutorials

---

### Day 10: Docker Deployment & Project Handoff

#### Focus: Make the system deployable and document next steps

**Tasks:**

**1. Docker Optimization** (3 hours)
- Verify all services have Dockerfiles
- Test `docker-compose up` starts everything
- Add health checks to docker-compose
- Fix any startup issues

**2. Deployment Guide** (3 hours)
- Create `DEPLOYMENT.md`:
  - How to deploy with Docker Compose
  - How to run migrations
  - How to access services
  - Troubleshooting common issues
- Document ports for all services

**3. Data Seeding Script** (2 hours)
- Create comprehensive seed script:
  - 2 tenants (POLICE, COURT)
  - 5 users per tenant
  - 3 roles with permissions
  - 10 sample cases
- Make it easy to reset demo data

**4. Phase 2 Planning** (4 hours)
- Create `ROADMAP.md` documenting:
  - **Phase 1 Complete** (2 weeks): MVP with auth, cases, RBAC, audit
  - **Phase 2** (2-3 weeks): Referrals, file attachments, workflow engine
  - **Phase 3** (2-3 weeks): Notifications, webhooks, integrations
  - **Phase 4** (2-3 weeks): Advanced features, reporting, analytics
  - **Phase 5** (ongoing): Production hardening, scaling, frontend
- Identify technical debt and future improvements

**Deliverables:**
- ✅ System runs with `docker-compose up`
- ✅ Deployment documentation complete
- ✅ Demo data seed script working
- ✅ Clear roadmap for future phases

**Skip for Phase 1**: CI/CD pipeline, Kubernetes, production monitoring

---

## Phase 1 Success Criteria

### Minimum Viable Product (MVP) Requirements

**Core Functionality:**
- [ ] User registration and login working
- [ ] JWT authentication protecting all routes
- [ ] Create, view, update, delete cases
- [ ] Assign cases to users
- [ ] Basic workflow (status transitions)
- [ ] Role-based access control (Admin, Case Manager, Viewer)
- [ ] Audit logging for all major actions
- [ ] Multi-tenant data isolation verified

**Technical Requirements:**
- [ ] Docker Compose starts all required services (Postgres, Redis, API Gateway, Auth, Case, RBAC, Audit)
- [ ] Database migrations run successfully
- [ ] Seed data script populates demo data
- [ ] Basic tests passing (10+ tests)
- [ ] API documented with examples

**Documentation:**
- [ ] README with setup instructions
- [ ] API documentation complete
- [ ] Architecture documented
- [ ] Postman collection ready
- [ ] Phase 2 roadmap created

### Definition of Done for Phase 1

A demo can be performed showing:
1. ✅ Register new user → Login → Get token
2. ✅ Create case → View case → Update status
3. ✅ Assign case to another user
4. ✅ View audit log showing all actions
5. ✅ Verify user with Viewer role cannot create cases
6. ✅ Create tenant 2 → Verify tenant 1 data is invisible

**Performance Target**: API responses < 1 second (acceptable for MVP)

---

## Technical Stack Summary

- **Runtime**: Node.js 20+
- **Framework**: Express.js 5.x
- **Database**: PostgreSQL 15
- **ORM**: Prisma 6.0
- **Cache/Events**: Redis
- **Testing**: Jest + Supertest
- **Documentation**: Swagger/OpenAPI
- **Containerization**: Docker & Docker Compose

---

## Risk Mitigation

### Potential Blockers
1. **Database migration issues**: Test migrations in local environment first
2. **Inter-service communication**: Implement circuit breakers and timeouts
3. **File storage**: Start with local storage, plan for S3 later
4. **Email sending**: Use local SMTP server for testing

### Contingency Plans
- If behind schedule, prioritize core flows (auth, case CRUD, basic workflow)
- Defer advanced features (auto-assignment, complex workflows) to Week 3
- Focus on vertical slices (complete one flow end-to-end before moving to next)

---

## Multi-Phase Project Roadmap

### Phase 1: MVP Foundation (2 weeks) ← **YOU ARE HERE**
- ✅ Authentication & authorization
- ✅ Basic case management
- ✅ Simple workflow
- ✅ Audit logging
- ✅ Multi-tenancy

### Phase 2: Advanced Case Management (2-3 weeks)
- Cross-tenant referrals
- File attachments (upload, download)
- Advanced workflow engine with custom states
- Case search and filtering
- Email notifications

### Phase 3: Integration & Extensions (2-3 weeks)
- Webhooks for external systems
- REST API integrations
- Notification service (email, SMS, in-app)
- Integration service for legacy systems
- Real-time updates (WebSockets)

### Phase 4: Reporting & Analytics (2-3 weeks)
- Dashboard with KPIs
- Case statistics and reports
- User productivity metrics
- SLA tracking and alerts
- Export to Excel/PDF

### Phase 5: Production & Scaling (ongoing)
- Comprehensive test coverage (80%+)
- CI/CD pipeline
- Kubernetes deployment
- Monitoring (Prometheus, Grafana)
- Performance optimization
- Security hardening
- Database-per-service migration

### Phase 6: Frontend Development (4-6 weeks)
- Admin portal (React/Vue)
- User dashboard
- Case management UI
- Reporting interface
- Mobile app

### Future Enhancements
- OAuth2/SAML for enterprise SSO
- Two-factor authentication
- Advanced RBAC with custom permissions
- AI-powered case routing
- Document OCR and analysis
- Voice/video call integration

---

## Daily Workflow for Phase 1

**Start of Day:**
- [ ] Pull latest code
- [ ] Review today's plan deliverables
- [ ] Start Docker services (`docker-compose up -d`)
- [ ] Run any new migrations

**During Development:**
- [ ] Focus on ONE feature at a time (avoid scope creep)
- [ ] Test manually after each change
- [ ] Write basic validation
- [ ] Commit working code frequently

**End of Day:**
- [ ] Test the day's feature end-to-end
- [ ] Document any API changes
- [ ] Commit and push code
- [ ] Update checklist in task.md
- [ ] Note any blockers for discussion

**Important Reminders:**
- 🎯 **Focus on working code over perfect code** - MVPs don't need to be perfect
- 🚫 **Avoid feature creep** - stick to the plan, defer nice-to-haves to Phase 2
- ✅ **Test with real data** - use the seed script to create realistic scenarios
- 📝 **Document as you go** - don't leave it all for the end
