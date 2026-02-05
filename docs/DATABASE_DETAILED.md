# IACMS Database Detailed Documentation
## Tables, Relationships, and Examples

---

## Table of Contents
1. [Simple Overview (Beginner-Friendly)](#simple-overview-beginner-friendly)
2. [Overview](#overview)
3. [Core Tables](#core-tables)
4. [RBAC Tables](#rbac-tables)
5. [Case Management Tables](#case-management-tables)
6. [Audit & Integration Tables](#audit--integration-tables)
7. [Relationships Diagram](#relationships-diagram)
8. [Real-World Examples](#real-world-examples)
9. [Common Queries](#common-queries)

---

## Simple Overview (Beginner-Friendly)

### What is a Database?

Think of a database like a **digital filing cabinet**. Each drawer in the cabinet is called a **table**, and each table stores a specific type of information.

### The 15 Tables Explained Simply

Our system has 15 "drawers" (tables) organized into 4 groups:

---

### 🏢 Group 1: Core Tables (The Foundation)

These tables answer: **"Who uses the system?"**

| Table | Simple Explanation | Real-World Analogy |
|-------|-------------------|-------------------|
| **tenants** | List of organizations using the system | Like a list of companies renting office space in a building |
| **users** | People who log into the system | Like employee ID cards for each organization |

**Example:**
- `tenants`: Police Department, Court System, Health Services
- `users`: John Doe (works at Police), Judge Brown (works at Courts)

**Why separate tables?**
- One organization can have many employees
- Each employee belongs to exactly one organization
- Keeps data organized and secure

---

### 🔐 Group 2: RBAC Tables (Security & Permissions)

These tables answer: **"Who can do what?"**

RBAC = **R**ole-**B**ased **A**ccess **C**ontrol

| Table | Simple Explanation | Real-World Analogy |
|-------|-------------------|-------------------|
| **roles** | Job titles/positions | Like "Manager", "Officer", "Intern" |
| **permissions** | Specific actions someone can do | Like keys to different rooms |
| **role_permissions** | Which roles have which permissions | Like a chart showing which job title gets which keys |
| **user_roles** | Which users have which roles | Like assigning job titles to employees |

**Example Flow:**
```
John Doe (user) 
    → has role "Case Officer" (user_roles)
    → "Case Officer" role has permissions (role_permissions)
    → Permissions: "create case", "read case", "update case"
    → John can create, read, and update cases!
```

**Why 4 separate tables instead of 1?**
- **Flexibility**: One person can have multiple roles
- **Reusability**: Same role can be given to many people
- **Easy changes**: Update a role once, affects everyone with that role

---

### 📁 Group 3: Case Management Tables (The Main Work)

These tables answer: **"What work is being done?"**

| Table | Simple Explanation | Real-World Analogy |
|-------|-------------------|-------------------|
| **cases** | The actual case files | Like folders in a filing cabinet |
| **workflows** | Rules for how cases move through stages | Like a flowchart showing steps to complete a task |
| **workflow_states** | History of a case moving through stages | Like stamps showing when a package passed each checkpoint |
| **assignments** | Who is working on which case | Like a task assignment board |
| **case_referrals** | Sending cases to other organizations | Like forwarding a letter to another department |
| **case_attachments** | Files attached to cases | Like documents stapled to a case folder |

**Example - Case Lifecycle:**
```
1. Case Created (cases table)
   → Status: "Open"
   → Assigned to: Officer John

2. Officer works on it (workflow_states)
   → Status changes: "Open" → "Investigation" → "Review"

3. Case needs Court (case_referrals)
   → Referred to: Court System
   → Status: "Pending acceptance"

4. Court accepts and continues work
   → New assignment in Courts

5. Case closed (workflow_states)
   → Final status: "Closed"
```

---

### 📊 Group 4: Audit & Integration Tables (Record Keeping)

These tables answer: **"What happened and how do we connect to other systems?"**

| Table | Simple Explanation | Real-World Analogy |
|-------|-------------------|-------------------|
| **audit_logs** | Record of every action taken | Like security camera footage - records everything |
| **webhooks** | Automatic notifications to other systems | Like automatic email alerts |
| **integrations** | Connections to external systems | Like bridges connecting to other buildings |

**Why Audit Logs?**
- **Accountability**: Know who did what and when
- **Compliance**: Government systems require complete records
- **Investigation**: If something goes wrong, can trace back

---

### How Tables Connect (Relationships)

Think of relationships like connections between tables:

```
                    ┌─────────────────┐
                    │    TENANTS      │
                    │  (Organizations)│
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
    ┌───────────┐    ┌───────────┐    ┌───────────┐
    │   USERS   │    │   CASES   │    │ WORKFLOWS │
    │ (People)  │    │  (Work)   │    │  (Rules)  │
    └─────┬─────┘    └─────┬─────┘    └───────────┘
          │                │
          ▼                ▼
    ┌───────────┐    ┌───────────────────────────┐
    │USER_ROLES │    │ WORKFLOW_STATES           │
    │           │    │ ASSIGNMENTS               │
    └─────┬─────┘    │ CASE_REFERRALS            │
          │          │ CASE_ATTACHMENTS          │
          ▼          └───────────────────────────┘
    ┌───────────┐
    │   ROLES   │
    └─────┬─────┘
          │
          ▼
    ┌─────────────────┐
    │ROLE_PERMISSIONS │
    └─────┬───────────┘
          │
          ▼
    ┌───────────┐
    │PERMISSIONS│
    └───────────┘
```

---

### Key Concepts Explained Simply

#### 1. Multi-Tenancy (Data Isolation)
**Problem:** Police and Courts both use the same system, but Police shouldn't see Court's private data.

**Solution:** Every record has a `tenant_id` tag:
```
Case #1: tenant_id = "Police"    → Only Police users can see this
Case #2: tenant_id = "Courts"    → Only Courts users can see this
```

It's like having separate folders for each organization in the same cabinet.

#### 2. UUID (Unique Identifiers)
Instead of simple numbers (1, 2, 3), we use long random codes like:
```
550e8400-e29b-41d4-a716-446655440000
```

**Why?**
- Works across multiple servers
- Can't guess other IDs (security)
- No conflicts when merging data

#### 3. Junction Tables (Many-to-Many)
**Problem:** One user can have many roles, AND one role can belong to many users.

**Solution:** Create a middle table (`user_roles`) that links them:
```
USERS table          USER_ROLES table       ROLES table
┌─────────┐         ┌────────────────┐     ┌─────────┐
│ John    │─────────│ John → Admin   │─────│ Admin   │
│ Jane    │─────────│ John → Officer │     │ Officer │
│ Bob     │         │ Jane → Admin   │─────│ Viewer  │
└─────────┘         │ Jane → Viewer  │     └─────────┘
                    │ Bob  → Viewer  │
                    └────────────────┘
```

#### 4. Foreign Keys (Connections)
When one table references another, we use a "foreign key":
```
CASES table
┌──────────────────────────────────┐
│ id: "case-001"                   │
│ title: "Theft Case"              │
│ tenant_id: "police-123"  ←───────│── Points to TENANTS table
│ created_by: "user-456"   ←───────│── Points to USERS table
│ workflow_id: "wf-789"    ←───────│── Points to WORKFLOWS table
└──────────────────────────────────┘
```

#### 5. Soft Delete vs Hard Delete
**Hard Delete:** Record is permanently removed (gone forever)
**Soft Delete:** Record gets a `deleted_at` timestamp (hidden but recoverable)

```
-- Hard Delete (dangerous)
DELETE FROM cases WHERE id = 'case-001';  -- Gone forever!

-- Soft Delete (safe)
UPDATE cases SET deleted_at = NOW() WHERE id = 'case-001';  -- Hidden but can be restored
```

---

### Visual Summary: All 15 Tables

```
┌─────────────────────────────────────────────────────────────────┐
│                     IACMS DATABASE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🏢 CORE (Foundation)                                           │
│  ┌──────────┐  ┌──────────┐                                     │
│  │ tenants  │  │  users   │                                     │
│  │(1 record │  │(1 record │                                     │
│  │ per org) │  │per person│                                     │
│  └──────────┘  └──────────┘                                     │
│                                                                 │
│  🔐 RBAC (Security)                                             │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  ┌────────┐│
│  │  roles   │  │permissions │  │role_permissions  │  │user_   ││
│  │(job      │  │(actions    │  │(role→permission) │  │roles   ││
│  │ titles)  │  │ allowed)   │  │                  │  │        ││
│  └──────────┘  └────────────┘  └──────────────────┘  └────────┘│
│                                                                 │
│  📁 CASE MANAGEMENT (Main Work)                                 │
│  ┌──────────┐  ┌───────────┐  ┌─────────────────┐              │
│  │  cases   │  │ workflows │  │ workflow_states │              │
│  │(the work)│  │(the rules)│  │(history)        │              │
│  └──────────┘  └───────────┘  └─────────────────┘              │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────────┐      │
│  │assignments │  │case_referrals  │  │case_attachments  │      │
│  │(who works) │  │(share between  │  │(files)           │      │
│  │            │  │ organizations) │  │                  │      │
│  └────────────┘  └────────────────┘  └──────────────────┘      │
│                                                                 │
│  📊 AUDIT & INTEGRATION (Record Keeping)                        │
│  ┌────────────┐  ┌──────────┐  ┌──────────────┐                │
│  │ audit_logs │  │ webhooks │  │ integrations │                │
│  │(who did    │  │(auto     │  │(connections  │                │
│  │ what when) │  │ alerts)  │  │ to others)   │                │
│  └────────────┘  └──────────┘  └──────────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### Quick Reference: What Each Table Stores

| # | Table Name | Stores | Example Record |
|---|------------|--------|----------------|
| 1 | `tenants` | Organizations | Police Department, code: POLICE |
| 2 | `users` | People/accounts | John Doe, email: john@police.gov |
| 3 | `roles` | Job titles | "Admin", "Case Manager", "Viewer" |
| 4 | `permissions` | Allowed actions | "cases:create", "users:delete" |
| 5 | `role_permissions` | Role→Permission links | Admin role has all permissions |
| 6 | `user_roles` | User→Role links | John has Admin role |
| 7 | `workflows` | Process definitions | 5 steps: open→review→closed |
| 8 | `cases` | Case records | Theft Case #123, priority: high |
| 9 | `workflow_states` | State change history | Case moved from "open" to "review" |
| 10 | `assignments` | Who works on what | Case #123 assigned to John |
| 11 | `case_referrals` | Cross-org sharing | Police sent case to Courts |
| 12 | `case_attachments` | Uploaded files | evidence_photo.jpg |
| 13 | `audit_logs` | Action history | John created case at 10:00 AM |
| 14 | `webhooks` | Auto-notifications | Send alert when case created |
| 15 | `integrations` | External connections | Link to legacy police system |

---

## Overview

The IACMS database consists of **15 tables** organized into 4 logical groups:
- **Core Tables (2)**: Foundation for multi-tenancy
- **RBAC Tables (4)**: Security and permissions
- **Case Management Tables (6)**: Core business logic
- **Audit & Integration Tables (3)**: Compliance and external systems

---

## Core Tables

### 1. `tenants`
**Purpose**: Represents organizations using the system (Police, Courts, Health Services, etc.)

**Key Fields**:
- `id` (UUID, PK)
- `code` (String, Unique) - e.g., 'POLICE', 'COURTS', 'HEALTH'
- `name` - Full organization name
- `config` (JSONB) - Tenant-specific settings

**Example Data**:
```sql
INSERT INTO tenants (id, name, code, description) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Police Department', 'POLICE', 'Law enforcement agency'),
('550e8400-e29b-41d4-a716-446655440001', 'Court System', 'COURTS', 'Judicial system'),
('550e8400-e29b-41d4-a716-446655440002', 'Health Services', 'HEALTH', 'Public health department');
```

**Relationships**:
- One tenant → Many users (`users.tenant_id`)
- One tenant → Many cases (`cases.tenant_id`)
- One tenant → Many workflows (`workflows.tenant_id`)

---

### 2. `users`
**Purpose**: User accounts belonging to organizations

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (FK → tenants.id) - **Critical for multi-tenancy**
- `email` (Unique per tenant)
- `username` (Unique per tenant)
- `password_hash`
- `first_name`, `last_name`

**Example Data**:
```sql
-- Police Department Users
INSERT INTO users (id, tenant_id, email, username, first_name, last_name, password_hash) VALUES
('660e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440000', 'john.doe@police.gov', 'jdoe', 'John', 'Doe', '$2b$10$...'),
('660e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'jane.smith@police.gov', 'jsmith', 'Jane', 'Smith', '$2b$10$...');

-- Court System Users
INSERT INTO users (id, tenant_id, email, username, first_name, last_name, password_hash) VALUES
('660e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440001', 'judge.brown@courts.gov', 'jbrown', 'Judge', 'Brown', '$2b$10$...');
```

**Relationships**:
- Many users → One tenant (`users.tenant_id → tenants.id`)
- One user → Many cases created (`cases.created_by → users.id`)
- One user → Many case assignments (`assignments.assigned_to → users.id`)
- Many users ↔ Many roles (`user_roles` junction table)

**Important**: Email uniqueness is **per tenant**, not global:
- `john@police.gov` (POLICE tenant) ✅
- `john@police.gov` (COURTS tenant) ✅ (same email, different tenant)

---

## RBAC Tables

### 3. `roles`
**Purpose**: Role definitions (can be tenant-specific or system-wide)

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (FK → tenants.id, **nullable**) - NULL = system-wide role
- `name` - Role name (unique per tenant)
- `is_system_role` - Cannot be deleted

**Example Data**:
```sql
-- System-wide roles (tenant_id = NULL)
INSERT INTO roles (id, tenant_id, name, is_system_role) VALUES
('770e8400-e29b-41d4-a716-446655440000', NULL, 'admin', TRUE),
('770e8400-e29b-41d4-a716-446655440001', NULL, 'auditor', TRUE);

-- Tenant-specific roles
INSERT INTO roles (id, tenant_id, name, is_system_role) VALUES
('770e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', 'case_officer', FALSE),
('770e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440000', 'supervisor', FALSE),
('770e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440001', 'clerk', FALSE);
```

**Relationships**:
- Many roles → One tenant (`roles.tenant_id → tenants.id`, nullable)
- Many roles ↔ Many permissions (`role_permissions` junction)
- Many users ↔ Many roles (`user_roles` junction)

---

### 4. `permissions`
**Purpose**: Permission definitions (system-wide, not tenant-specific)

**Key Fields**:
- `id` (UUID, PK)
- `resource` - e.g., 'cases', 'workflows', 'users'
- `action` - e.g., 'create', 'read', 'update', 'delete'
- Unique constraint: `(resource, action)`

**Example Data**:
```sql
INSERT INTO permissions (id, resource, action, description) VALUES
('880e8400-e29b-41d4-a716-446655440000', 'cases', 'create', 'Create new cases'),
('880e8400-e29b-41d4-a716-446655440001', 'cases', 'read', 'View cases'),
('880e8400-e29b-41d4-a716-446655440002', 'cases', 'update', 'Update cases'),
('880e8400-e29b-41d4-a716-446655440003', 'cases', 'delete', 'Delete cases'),
('880e8400-e29b-41d4-a716-446655440004', 'cases', 'assign', 'Assign cases to users'),
('880e8400-e29b-41d4-a716-446655440005', 'workflows', 'create', 'Create workflows'),
('880e8400-e29b-41d4-a716-446655440006', 'users', 'read', 'View users');
```

**Relationships**:
- Many permissions ↔ Many roles (`role_permissions` junction)

---

### 5. `role_permissions` (Junction Table)
**Purpose**: Links roles to permissions (Many-to-Many)

**Key Fields**:
- `role_id` (FK → roles.id)
- `permission_id` (FK → permissions.id)
- Unique constraint: `(role_id, permission_id)`

**Example Data**:
```sql
-- Give 'case_officer' role permissions to create, read, update cases
INSERT INTO role_permissions (role_id, permission_id) VALUES
('770e8400-e29b-41d4-a716-446655440002', '880e8400-e29b-41d4-a716-446655440000'), -- cases:create
('770e8400-e29b-41d4-a716-446655440002', '880e8400-e29b-41d4-a716-446655440001'), -- cases:read
('770e8400-e29b-41d4-a716-446655440002', '880e8400-e29b-41d4-a716-446655440002'); -- cases:update

-- Give 'supervisor' role all case permissions
INSERT INTO role_permissions (role_id, permission_id) VALUES
('770e8400-e29b-41d4-a716-446655440003', '880e8400-e29b-41d4-a716-446655440000'), -- cases:create
('770e8400-e29b-41d4-a716-446655440003', '880e8400-e29b-41d4-a716-446655440001'), -- cases:read
('770e8400-e29b-41d4-a716-446655440003', '880e8400-e29b-41d4-a716-446655440002'), -- cases:update
('770e8400-e29b-41d4-a716-446655440003', '880e8400-e29b-41d4-a716-446655440003'), -- cases:delete
('770e8400-e29b-41d4-a716-446655440003', '880e8400-e29b-41d4-a716-446655440004'); -- cases:assign
```

**Why Junction Table?**
- One role can have many permissions
- One permission can belong to many roles
- Without this table, you'd need to duplicate data

---

### 6. `user_roles` (Junction Table)
**Purpose**: Links users to roles (Many-to-Many)

**Key Fields**:
- `user_id` (FK → users.id)
- `role_id` (FK → roles.id)
- `assigned_by` (FK → users.id) - Who assigned this role
- `expires_at` - For temporary role assignments

**Example Data**:
```sql
-- Assign John Doe as case_officer
INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES
('660e8400-e29b-41d4-a716-446655440000', '770e8400-e29b-41d4-a716-446655440002', '660e8400-e29b-41d4-a716-446655440001');

-- Assign Jane Smith as supervisor (can also be case_officer)
INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES
('660e8400-e29b-41d4-a716-446655440001', '770e8400-e29b-41d4-a716-446655440003', '660e8400-e29b-41d4-a716-446655440001'),
('660e8400-e29b-41d4-a716-446655440001', '770e8400-e29b-41d4-a716-446655440002', '660e8400-e29b-41d4-a716-446655440001');
```

**Why Junction Table?**
- Users can have multiple roles (e.g., case_officer AND supervisor)
- Roles can be assigned to multiple users
- Tracks who assigned the role and when

---

## Case Management Tables

### 7. `workflows`
**Purpose**: Workflow definitions per tenant (defines how cases move through states)

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (FK → tenants.id)
- `name` - Workflow name
- `definition` (JSONB) - State machine definition
- `is_default` - Default workflow for tenant

**Example Data**:
```sql
-- Police Department Workflow
INSERT INTO workflows (id, tenant_id, name, definition, is_default) VALUES
('990e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440000', 'Criminal Case Workflow', 
'{
  "states": ["investigation", "review", "prosecution", "court", "closed"],
  "transitions": [
    {"from": "investigation", "to": "review", "condition": "evidence_complete"},
    {"from": "review", "to": "prosecution", "condition": "approved"},
    {"from": "prosecution", "to": "court", "condition": "charges_filed"},
    {"from": "court", "to": "closed", "condition": "verdict_reached"}
  ]
}', TRUE);
```

**Relationships**:
- Many workflows → One tenant (`workflows.tenant_id → tenants.id`)
- One workflow → Many cases (`cases.workflow_id → workflows.id`)
- One workflow → Many state transitions (`workflow_states.workflow_id → workflows.id`)

---

### 8. `cases`
**Purpose**: Core case records - the main entity

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (FK → tenants.id) - **Original owning tenant**
- `originating_tenant_id` (FK → tenants.id) - **Who created it**
- `current_tenant_id` (FK → tenants.id) - **Who is handling it now**
- `referral_status` - 'none', 'referred', 'accepted', 'rejected'
- `case_number` (Unique) - Format: ORG-YYYY-XXXXX
- `workflow_id` (FK → workflows.id)
- `assigned_to` (FK → users.id)
- `created_by` (FK → users.id)

**Example Data**:
```sql
-- Case created by Police
INSERT INTO cases (id, tenant_id, originating_tenant_id, current_tenant_id, referral_status, 
                   case_number, title, type, priority, status, workflow_id, created_by) VALUES
('aa0e8400-e29b-41d4-a716-446655440000', 
 '550e8400-e29b-41d4-a716-446655440000', -- POLICE tenant
 '550e8400-e29b-41d4-a716-446655440000', -- Created by POLICE
 '550e8400-e29b-41d4-a716-446655440000', -- Currently handled by POLICE
 'none',
 'POLICE-2024-00123',
 'Theft Case #123',
 'criminal',
 'high',
 'investigation',
 '990e8400-e29b-41d4-a716-446655440000', -- workflow
 '660e8400-e29b-41d4-a716-446655440000'); -- created by John Doe
```

**Relationships**:
- Many cases → One tenant (`cases.tenant_id → tenants.id`)
- Many cases → One workflow (`cases.workflow_id → workflows.id`)
- Many cases → One assigned user (`cases.assigned_to → users.id`)
- One case → One creator (`cases.created_by → users.id`)
- One case → Many state transitions (`workflow_states.case_id → cases.id`)
- One case → Many assignments (`assignments.case_id → cases.id`)
- One case → Many referrals (`case_referrals.case_id → cases.id`)
- One case → Many attachments (`case_attachments.case_id → cases.id`)

---

### 9. `workflow_states`
**Purpose**: Tracks history of state transitions for cases

**Key Fields**:
- `id` (UUID, PK)
- `case_id` (FK → cases.id)
- `workflow_id` (FK → workflows.id)
- `current_state` - Current state name
- `previous_state` - Previous state name
- `transitioned_by` (FK → users.id)

**Example Data**:
```sql
-- Case starts in 'investigation' state
INSERT INTO workflow_states (case_id, workflow_id, current_state, previous_state, transitioned_by) VALUES
('aa0e8400-e29b-41d4-a716-446655440000', '990e8400-e29b-41d4-a716-446655440000', 'investigation', NULL, '660e8400-e29b-41d4-a716-446655440000');

-- Case moves to 'review' state
INSERT INTO workflow_states (case_id, workflow_id, current_state, previous_state, transitioned_by) VALUES
('aa0e8400-e29b-41d4-a716-446655440000', '990e8400-e29b-41d4-a716-446655440000', 'review', 'investigation', '660e8400-e29b-41d4-a716-446655440001');

-- Case moves to 'prosecution' state
INSERT INTO workflow_states (case_id, workflow_id, current_state, previous_state, transitioned_by) VALUES
('aa0e8400-e29b-41d4-a716-446655440000', '990e8400-e29b-41d4-a716-446655440000', 'prosecution', 'review', '660e8400-e29b-41d4-a716-446655440001');
```

**Why Separate Table?**
- **History**: Tracks every state change
- **Audit**: Who changed the state and when
- **Analysis**: Can see how long cases spend in each state

**Relationships**:
- Many states → One case (`workflow_states.case_id → cases.id`)
- Many states → One workflow (`workflow_states.workflow_id → workflows.id`)
- Many states → One user (`workflow_states.transitioned_by → users.id`)

---

### 10. `assignments`
**Purpose**: Tracks case assignment history (who was assigned, when, why)

**Key Fields**:
- `id` (UUID, PK)
- `case_id` (FK → cases.id)
- `assigned_to` (FK → users.id) - Who the case is assigned to
- `assigned_by` (FK → users.id) - Who made the assignment
- `assignment_type` - 'manual', 'auto', 'escalated'
- `is_active` - Current assignment

**Example Data**:
```sql
-- Initial assignment (auto)
INSERT INTO assignments (case_id, assigned_to, assigned_by, assignment_type, is_active) VALUES
('aa0e8400-e29b-41d4-a716-446655440000', '660e8400-e29b-41d4-a716-446655440000', '660e8400-e29b-41d4-a716-446655440001', 'auto', TRUE);

-- Reassignment (manual)
INSERT INTO assignments (case_id, assigned_to, assigned_by, assignment_type, is_active) VALUES
('aa0e8400-e29b-41d4-a716-446655440000', '660e8400-e29b-41d4-a716-446655440001', '660e8400-e29b-41d4-a716-446655440001', 'manual', TRUE);
-- Previous assignment is_active = FALSE (handled in application)
```

**Why Separate Table?**
- **History**: Tracks all assignments, not just current
- **Accountability**: Who assigned and why
- **Analysis**: Workload distribution over time

**Relationships**:
- Many assignments → One case (`assignments.case_id → cases.id`)
- Many assignments → One assigned user (`assignments.assigned_to → users.id`)
- Many assignments → One assigner (`assignments.assigned_by → users.id`)

---

### 11. `case_referrals`
**Purpose**: Tracks referrals of cases between organizations

**Key Fields**:
- `id` (UUID, PK)
- `case_id` (FK → cases.id)
- `from_tenant_id` (FK → tenants.id) - Referring organization
- `to_tenant_id` (FK → tenants.id) - Receiving organization
- `status` - 'pending', 'accepted', 'rejected', 'completed'
- `referred_by` (FK → users.id)
- `accepted_by` (FK → users.id, nullable)

**Example Data**:
```sql
-- Police refers case to Courts
INSERT INTO case_referrals (case_id, from_tenant_id, to_tenant_id, status, referred_by, referral_reason) VALUES
('aa0e8400-e29b-41d4-a716-446655440000',
 '550e8400-e29b-41d4-a716-446655440000', -- POLICE
 '550e8400-e29b-41d4-a716-446655440001', -- COURTS
 'pending',
 '660e8400-e29b-41d4-a716-446655440001', -- Jane Smith
 'Investigation complete, ready for prosecution');

-- Update case referral status
UPDATE cases SET 
    referral_status = 'referred',
    current_tenant_id = '550e8400-e29b-41d4-a716-446655440001' -- COURTS
WHERE id = 'aa0e8400-e29b-41d4-a716-446655440000';

-- Courts accepts referral
UPDATE case_referrals SET 
    status = 'accepted',
    accepted_by = '660e8400-e29b-41d4-a716-446655440002', -- Judge Brown
    accepted_at = NOW()
WHERE case_id = 'aa0e8400-e29b-41d4-a716-446655440000';

UPDATE cases SET referral_status = 'accepted' WHERE id = 'aa0e8400-e29b-41d4-a716-446655440000';
```

**Relationships**:
- Many referrals → One case (`case_referrals.case_id → cases.id`)
- Many referrals → One from tenant (`case_referrals.from_tenant_id → tenants.id`)
- Many referrals → One to tenant (`case_referrals.to_tenant_id → tenants.id`)
- Many referrals → One referrer (`case_referrals.referred_by → users.id`)
- Many referrals → One accepter (`case_referrals.accepted_by → users.id`)

---

### 12. `case_attachments`
**Purpose**: File attachments for cases

**Key Fields**:
- `id` (UUID, PK)
- `case_id` (FK → cases.id)
- `tenant_id` (FK → tenants.id)
- `filename`, `original_filename`
- `file_path` - Path on filesystem
- `uploaded_by` (FK → users.id)

**Example Data**:
```sql
INSERT INTO case_attachments (case_id, tenant_id, filename, original_filename, mime_type, file_size, file_path, uploaded_by) VALUES
('aa0e8400-e29b-41d4-a716-446655440000',
 '550e8400-e29b-41d4-a716-446655440000',
 'evidence_photo_001.jpg',
 'Evidence Photo 1.jpg',
 'image/jpeg',
 245760,
 '/uploads/cases/aa0e8400-e29b-41d4-a716-446655440000/evidence_photo_001.jpg',
 '660e8400-e29b-41d4-a716-446655440000');
```

**Relationships**:
- Many attachments → One case (`case_attachments.case_id → cases.id`)
- Many attachments → One tenant (`case_attachments.tenant_id → tenants.id`)
- Many attachments → One uploader (`case_attachments.uploaded_by → users.id`)

---

## Audit & Integration Tables

### 13. `audit_logs`
**Purpose**: Immutable audit trail for compliance

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (FK → tenants.id)
- `entity_type` - 'case', 'user', 'workflow', etc.
- `entity_id` - ID of the entity
- `action` - 'create', 'update', 'delete', 'view'
- `user_id` (FK → users.id)
- `old_values`, `new_values` (JSONB)

**Example Data**:
```sql
-- Case created
INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, user_id, new_values) VALUES
('550e8400-e29b-41d4-a716-446655440000',
 'case',
 'aa0e8400-e29b-41d4-a716-446655440000',
 'create',
 '660e8400-e29b-41d4-a716-446655440000',
 '{"title": "Theft Case #123", "type": "criminal", "priority": "high"}');

-- Case status updated
INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, user_id, old_values, new_values) VALUES
('550e8400-e29b-41d4-a716-446655440000',
 'case',
 'aa0e8400-e29b-41d4-a716-446655440000',
 'update',
 '660e8400-e29b-41d4-a716-446655440001',
 '{"status": "investigation"}',
 '{"status": "review"}');
```

**Relationships**:
- Many logs → One tenant (`audit_logs.tenant_id → tenants.id`)
- Many logs → One user (`audit_logs.user_id → users.id`)

**Important**: This table is **immutable** - never UPDATE or DELETE!

---

### 14. `webhooks`
**Purpose**: Webhook subscriptions for event notifications

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (FK → tenants.id, nullable) - NULL = system-wide
- `url` - Webhook endpoint
- `events` (JSONB) - Array of event types
- `secret` - For HMAC signature

**Example Data**:
```sql
-- Tenant-specific webhook
INSERT INTO webhooks (tenant_id, name, url, events, secret) VALUES
('550e8400-e29b-41d4-a716-446655440000',
 'Court System Notifications',
 'https://courts.gov/api/webhooks',
 '["case.referred", "case.status_changed"]',
 'webhook_secret_key_123');

-- System-wide webhook
INSERT INTO webhooks (tenant_id, name, url, events) VALUES
(NULL,
 'System Monitoring',
 'https://monitoring.gov/api/webhooks',
 '["case.created", "case.resolved", "sla.breached"]');
```

**Relationships**:
- Many webhooks → One tenant (`webhooks.tenant_id → tenants.id`, nullable)
- Many webhooks → One creator (`webhooks.created_by → users.id`)

---

### 15. `integrations`
**Purpose**: External system integrations

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (FK → tenants.id, nullable)
- `type` - 'api', 'legacy_system', 'webhook'
- `endpoint_url`
- `api_key`, `api_secret` (encrypted)
- `last_sync_at` - Last synchronization time

**Example Data**:
```sql
INSERT INTO integrations (tenant_id, name, type, endpoint_url, config) VALUES
('550e8400-e29b-41d4-a716-446655440000',
 'Legacy Police System',
 'legacy_system',
 'https://legacy.police.gov/api',
 '{"sync_interval": 3600, "format": "xml"}');
```

**Relationships**:
- Many integrations → One tenant (`integrations.tenant_id → tenants.id`, nullable)
- Many integrations → One creator (`integrations.created_by → users.id`)

---

## Relationships Diagram

### Core Relationships Flow:

```
tenants (1) ──< (many) users
tenants (1) ──< (many) cases
tenants (1) ──< (many) workflows

users (many) ──< (many) user_roles ──> (many) roles
roles (many) ──< (many) role_permissions ──> (many) permissions

cases (1) ──< (many) workflow_states
cases (1) ──< (many) assignments
cases (1) ──< (many) case_referrals
cases (1) ──< (many) case_attachments

workflows (1) ──< (many) cases
workflows (1) ──< (many) workflow_states

users (1) ──< (many) cases (created_by)
users (1) ──< (many) cases (assigned_to)
users (1) ──< (many) assignments (assigned_to)
users (1) ──< (many) assignments (assigned_by)
```

---

## Real-World Examples

### Example 1: Complete Case Lifecycle

**Scenario**: Police creates a case, assigns it, refers to Courts, Courts processes it

#### Step 1: Create Case
```sql
-- 1. Case created by Police officer John Doe
INSERT INTO cases (id, tenant_id, originating_tenant_id, current_tenant_id, referral_status,
                   case_number, title, type, priority, status, workflow_id, created_by) VALUES
('case-001', 'police-tenant-id', 'police-tenant-id', 'police-tenant-id', 'none',
 'POLICE-2024-00123', 'Theft Case', 'criminal', 'high', 'investigation', 'workflow-001', 'john-doe-id');

-- 2. Audit log created
INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, user_id, new_values) VALUES
('police-tenant-id', 'case', 'case-001', 'create', 'john-doe-id', 
 '{"title": "Theft Case", "type": "criminal", "priority": "high"}');

-- 3. Initial workflow state
INSERT INTO workflow_states (case_id, workflow_id, current_state, previous_state, transitioned_by) VALUES
('case-001', 'workflow-001', 'investigation', NULL, 'john-doe-id');

-- 4. Auto-assignment
INSERT INTO assignments (case_id, assigned_to, assigned_by, assignment_type, is_active) VALUES
('case-001', 'jane-smith-id', 'system', 'auto', TRUE);
```

#### Step 2: Work on Case
```sql
-- 5. Case status updated
UPDATE cases SET status = 'review' WHERE id = 'case-001';

-- 6. Workflow state transition
INSERT INTO workflow_states (case_id, workflow_id, current_state, previous_state, transitioned_by) VALUES
('case-001', 'workflow-001', 'review', 'investigation', 'jane-smith-id');

-- 7. Audit log
INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, user_id, old_values, new_values) VALUES
('police-tenant-id', 'case', 'case-001', 'update', 'jane-smith-id',
 '{"status": "investigation"}', '{"status": "review"}');
```

#### Step 3: Refer to Courts
```sql
-- 8. Create referral
INSERT INTO case_referrals (case_id, from_tenant_id, to_tenant_id, status, referred_by, referral_reason) VALUES
('case-001', 'police-tenant-id', 'courts-tenant-id', 'pending', 'jane-smith-id', 
 'Investigation complete, ready for prosecution');

-- 9. Update case referral status
UPDATE cases SET 
    referral_status = 'referred',
    current_tenant_id = 'courts-tenant-id'
WHERE id = 'case-001';

-- 10. Audit log
INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, user_id, new_values) VALUES
('police-tenant-id', 'case_referral', 'referral-001', 'create', 'jane-smith-id',
 '{"from": "POLICE", "to": "COURTS", "status": "pending"}');
```

#### Step 4: Courts Accepts
```sql
-- 11. Courts accepts referral
UPDATE case_referrals SET 
    status = 'accepted',
    accepted_by = 'judge-brown-id',
    accepted_at = NOW()
WHERE case_id = 'case-001';

-- 12. Update case
UPDATE cases SET referral_status = 'accepted' WHERE id = 'case-001';

-- 13. Courts can now access case (RLS allows it)
-- Courts assigns to their user
INSERT INTO assignments (case_id, assigned_to, assigned_by, assignment_type, is_active) VALUES
('case-001', 'court-clerk-id', 'judge-brown-id', 'manual', TRUE);
```

#### Step 5: Case Resolved
```sql
-- 14. Case resolved
UPDATE cases SET 
    status = 'closed',
    resolved_at = NOW()
WHERE id = 'case-001';

-- 15. Final workflow state
INSERT INTO workflow_states (case_id, workflow_id, current_state, previous_state, transitioned_by) VALUES
('case-001', 'workflow-001', 'closed', 'court', 'judge-brown-id');

-- 16. Complete referral
UPDATE case_referrals SET 
    status = 'completed',
    completed_at = NOW()
WHERE case_id = 'case-001';
```

---

### Example 2: RBAC in Action

**Scenario**: User John Doe has role 'case_officer' with permissions to create and read cases

```sql
-- 1. User exists
SELECT * FROM users WHERE id = 'john-doe-id';
-- Returns: {id: 'john-doe-id', tenant_id: 'police-tenant-id', email: 'john@police.gov', ...}

-- 2. Get user's roles
SELECT r.* FROM roles r
JOIN user_roles ur ON r.id = ur.role_id
WHERE ur.user_id = 'john-doe-id';
-- Returns: [{id: 'role-001', name: 'case_officer', ...}]

-- 3. Get permissions for user's roles
SELECT p.* FROM permissions p
JOIN role_permissions rp ON p.id = rp.permission_id
JOIN user_roles ur ON rp.role_id = ur.role_id
WHERE ur.user_id = 'john-doe-id';
-- Returns: [
--   {resource: 'cases', action: 'create'},
--   {resource: 'cases', action: 'read'}
-- ]

-- 4. Check if user can create cases
SELECT COUNT(*) > 0 AS can_create FROM permissions p
JOIN role_permissions rp ON p.id = rp.permission_id
JOIN user_roles ur ON rp.role_id = ur.role_id
WHERE ur.user_id = 'john-doe-id' 
  AND p.resource = 'cases' 
  AND p.action = 'create';
-- Returns: TRUE
```

---

### Example 3: Multi-Tenant Data Isolation

**Scenario**: Police and Courts both have cases, but can only see their own

```sql
-- Set tenant context for Police
SET LOCAL app.current_tenant_id = 'police-tenant-id';

-- Police queries cases
SELECT * FROM cases;
-- Returns: Only cases where tenant_id = 'police-tenant-id'
-- OR cases referred to/from 'police-tenant-id'

-- Set tenant context for Courts
SET LOCAL app.current_tenant_id = 'courts-tenant-id';

-- Courts queries cases
SELECT * FROM cases;
-- Returns: Only cases where tenant_id = 'courts-tenant-id'
-- OR cases referred to/from 'courts-tenant-id'
-- OR cases where current_tenant_id = 'courts-tenant-id'
```

---

## Common Queries

### Query 1: Get all cases for a user with details
```sql
SELECT 
    c.id,
    c.case_number,
    c.title,
    c.status,
    c.priority,
    c.due_date,
    u_assigned.first_name || ' ' || u_assigned.last_name AS assigned_to_name,
    u_created.first_name || ' ' || u_created.last_name AS created_by_name,
    t.name AS tenant_name
FROM cases c
LEFT JOIN users u_assigned ON c.assigned_to = u_assigned.id
JOIN users u_created ON c.created_by = u_created.id
JOIN tenants t ON c.tenant_id = t.id
WHERE c.tenant_id = current_tenant_id()
  AND c.deleted_at IS NULL
ORDER BY c.created_at DESC;
```

### Query 2: Get case with full history
```sql
SELECT 
    c.*,
    json_agg(
        json_build_object(
            'state', ws.current_state,
            'previous_state', ws.previous_state,
            'transitioned_by', u.first_name || ' ' || u.last_name,
            'transitioned_at', ws.transitioned_at
        ) ORDER BY ws.transitioned_at
    ) AS state_history,
    json_agg(
        json_build_object(
            'assigned_to', u2.first_name || ' ' || u2.last_name,
            'assigned_by', u3.first_name || ' ' || u3.last_name,
            'assigned_at', a.assigned_at,
            'type', a.assignment_type
        ) ORDER BY a.assigned_at
    ) AS assignment_history
FROM cases c
LEFT JOIN workflow_states ws ON c.id = ws.case_id
LEFT JOIN users u ON ws.transitioned_by = u.id
LEFT JOIN assignments a ON c.id = a.case_id
LEFT JOIN users u2 ON a.assigned_to = u2.id
LEFT JOIN users u3 ON a.assigned_by = u3.id
WHERE c.id = 'case-001'
GROUP BY c.id;
```

### Query 3: Get pending referrals for a tenant
```sql
SELECT 
    cr.id,
    cr.status,
    cr.referral_reason,
    c.case_number,
    c.title,
    t_from.name AS from_organization,
    t_to.name AS to_organization,
    u_referred.first_name || ' ' || u_referred.last_name AS referred_by_name
FROM case_referrals cr
JOIN cases c ON cr.case_id = c.id
JOIN tenants t_from ON cr.from_tenant_id = t_from.id
JOIN tenants t_to ON cr.to_tenant_id = t_to.id
JOIN users u_referred ON cr.referred_by = u_referred.id
WHERE cr.to_tenant_id = current_tenant_id()
  AND cr.status = 'pending'
ORDER BY cr.referred_at DESC;
```

### Query 4: Get user permissions
```sql
SELECT DISTINCT
    p.resource,
    p.action,
    p.description
FROM permissions p
JOIN role_permissions rp ON p.id = rp.permission_id
JOIN user_roles ur ON rp.role_id = ur.role_id
WHERE ur.user_id = 'user-id'
  AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
ORDER BY p.resource, p.action;
```

### Query 5: Get cases with SLA approaching
```sql
SELECT 
    c.id,
    c.case_number,
    c.title,
    c.due_date,
    c.due_date - NOW() AS time_remaining,
    u.first_name || ' ' || u.last_name AS assigned_to_name
FROM cases c
LEFT JOIN users u ON c.assigned_to = u.id
WHERE c.tenant_id = current_tenant_id()
  AND c.status NOT IN ('closed', 'resolved')
  AND c.due_date IS NOT NULL
  AND c.due_date - NOW() < INTERVAL '24 hours'
ORDER BY c.due_date ASC;
```

### Query 6: Get all referrals for a case (incoming and outgoing)
```sql
SELECT 
    cr.*,
    t_from.name AS from_organization_name,
    t_to.name AS to_organization_name,
    u_referred.first_name || ' ' || u_referred.last_name AS referred_by_name,
    u_accepted.first_name || ' ' || u_accepted.last_name AS accepted_by_name,
    c.case_number,
    c.title AS case_title
FROM case_referrals cr
JOIN cases c ON cr.case_id = c.id
JOIN tenants t_from ON cr.from_tenant_id = t_from.id
JOIN tenants t_to ON cr.to_tenant_id = t_to.id
JOIN users u_referred ON cr.referred_by = u_referred.id
LEFT JOIN users u_accepted ON cr.accepted_by = u_accepted.id
WHERE cr.case_id = 'case-001'
ORDER BY cr.referred_at DESC;
```

### Query 7: Get workload for a user (active assignments)
```sql
SELECT 
    c.id,
    c.case_number,
    c.title,
    c.status,
    c.priority,
    c.due_date,
    CASE 
        WHEN c.due_date < NOW() THEN 'overdue'
        WHEN c.due_date - NOW() < INTERVAL '24 hours' THEN 'urgent'
        ELSE 'normal'
    END AS urgency
FROM cases c
JOIN assignments a ON c.id = a.case_id
WHERE a.assigned_to = 'user-id'
  AND a.is_active = TRUE
  AND c.deleted_at IS NULL
ORDER BY 
    CASE urgency
        WHEN 'overdue' THEN 1
        WHEN 'urgent' THEN 2
        ELSE 3
    END,
    c.due_date ASC;
```

### Query 8: Get audit trail for a case
```sql
SELECT 
    al.*,
    u.first_name || ' ' || u.last_name AS user_name,
    t.name AS tenant_name
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
JOIN tenants t ON al.tenant_id = t.id
WHERE al.entity_type = 'case'
  AND al.entity_id = 'case-001'
ORDER BY al.created_at DESC;
```

---

## Summary

The database design follows these principles:

1. **Normalization**: Each table has a single responsibility
2. **Multi-tenancy**: Every tenant-aware table has `tenant_id` with RLS
3. **History Tracking**: Separate tables for states, assignments, audit logs
4. **Flexibility**: Junction tables enable many-to-many relationships
5. **Compliance**: Immutable audit logs for all operations
6. **Performance**: Indexes on frequently queried columns

Each table serves a specific purpose and together they create a robust, scalable, and secure case management system.

---

## Key Relationships Summary

| Parent Table | Child Table | Relationship Type | Foreign Key |
|-------------|-------------|------------------|-------------|
| tenants | users | One-to-Many | users.tenant_id |
| tenants | cases | One-to-Many | cases.tenant_id |
| tenants | workflows | One-to-Many | workflows.tenant_id |
| users | cases | One-to-Many (created_by) | cases.created_by |
| users | cases | One-to-Many (assigned_to) | cases.assigned_to |
| users | assignments | One-to-Many (assigned_to) | assignments.assigned_to |
| users | assignments | One-to-Many (assigned_by) | assignments.assigned_by |
| users | user_roles | Many-to-Many | user_roles.user_id |
| roles | user_roles | Many-to-Many | user_roles.role_id |
| roles | role_permissions | Many-to-Many | role_permissions.role_id |
| permissions | role_permissions | Many-to-Many | role_permissions.permission_id |
| workflows | cases | One-to-Many | cases.workflow_id |
| workflows | workflow_states | One-to-Many | workflow_states.workflow_id |
| cases | workflow_states | One-to-Many | workflow_states.case_id |
| cases | assignments | One-to-Many | assignments.case_id |
| cases | case_referrals | One-to-Many | case_referrals.case_id |
| cases | case_attachments | One-to-Many | case_attachments.case_id |
| tenants | case_referrals | One-to-Many (from) | case_referrals.from_tenant_id |
| tenants | case_referrals | One-to-Many (to) | case_referrals.to_tenant_id |

---

## Notes

- All UUIDs in examples are placeholders - use actual UUIDs in real scenarios
- RLS policies automatically filter queries by tenant context
- Junction tables (`user_roles`, `role_permissions`) enable flexible many-to-many relationships
- History tables (`workflow_states`, `assignments`, `audit_logs`) preserve complete audit trail
- Referral system allows cross-tenant case sharing while maintaining data sovereignty

