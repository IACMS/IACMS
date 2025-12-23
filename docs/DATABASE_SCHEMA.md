# Database Schema Documentation

## Overview

The IACMS database schema is designed with multi-tenancy as a core principle. Every tenant-aware table includes a `tenant_id` column, and Row Level Security (RLS) policies ensure complete data isolation between tenants.

## Multi-Tenancy Architecture

### Tenant Isolation

- **Row Level Security (RLS)**: Enabled on all tenant-aware tables
- **Tenant Context**: Set via PostgreSQL session variables (`app.current_tenant_id`)
- **Automatic Filtering**: All queries are automatically filtered by tenant_id

### Setting Tenant Context

The tenant context is set via middleware before each request:

```javascript
// In middleware/tenant.js
await db.raw("SET LOCAL app.current_tenant_id = ?", [tenantId]);
```

## Database Tables

### Core Tables

#### `tenants`
Stores tenant (organization) information.

- `id` (UUID, Primary Key)
- `name` (String) - Organization name
- `code` (String, Unique) - Organization code (e.g., 'POLICE', 'COURTS')
- `config` (JSONB) - Tenant-specific configuration
- `is_active` (Boolean)
- `created_at`, `updated_at` (Timestamps)

#### `users`
Stores user accounts. Each user belongs to a tenant.

- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key → tenants.id)
- `email` (String, Unique per tenant)
- `username` (String, Unique per tenant)
- `password_hash` (String)
- `first_name`, `last_name` (String)
- `phone`, `national_id` (String, nullable)
- `is_active`, `is_email_verified` (Boolean)
- `last_login` (Timestamp, nullable)
- `created_at`, `updated_at` (Timestamps)

**RLS Policy**: Users can only access users from their own tenant.

#### `roles`
Stores role definitions. Can be tenant-specific or system-wide.

- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key → tenants.id, nullable)
  - NULL = system-wide role (e.g., 'admin', 'auditor')
  - Non-NULL = tenant-specific role
- `name` (String) - Role name (e.g., 'case_officer', 'supervisor')
- `description` (Text)
- `is_system_role` (Boolean) - Cannot be deleted
- `is_active` (Boolean)
- `created_at`, `updated_at` (Timestamps)

**RLS Policy**: Users can access roles from their tenant or system-wide roles.

#### `permissions`
Stores permission definitions (system-wide).

- `id` (UUID, Primary Key)
- `resource` (String) - Resource name (e.g., 'cases', 'workflows')
- `action` (String) - Action name (e.g., 'create', 'read', 'update', 'delete')
- `description` (Text)
- `created_at` (Timestamp)

#### `role_permissions`
Junction table linking roles to permissions.

- `id` (UUID, Primary Key)
- `role_id` (UUID, Foreign Key → roles.id)
- `permission_id` (UUID, Foreign Key → permissions.id)
- `created_at` (Timestamp)

#### `user_roles`
Junction table linking users to roles.

- `id` (UUID, Primary Key)
- `user_id` (UUID, Foreign Key → users.id)
- `role_id` (UUID, Foreign Key → roles.id)
- `assigned_by` (UUID, Foreign Key → users.id, nullable)
- `assigned_at` (Timestamp)
- `expires_at` (Timestamp, nullable) - For temporary assignments

### Case Management Tables

#### `cases`
Core case records.

- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key → tenants.id) - Original owning tenant
- `originating_tenant_id` (UUID, Foreign Key → tenants.id, nullable) - Organization that created the case
- `current_tenant_id` (UUID, Foreign Key → tenants.id, nullable) - Current organization handling the case
- `referral_status` (String) - 'none', 'referred', 'accepted', 'rejected'
- `case_number` (String, Unique) - Format: ORG-YYYY-XXXXX
- `title` (String)
- `description` (Text, nullable)
- `type` (String) - Case type (e.g., 'criminal', 'civil')
- `priority` (String) - 'low', 'normal', 'high', 'urgent'
- `status` (String) - Current status
- `workflow_id` (UUID, Foreign Key → workflows.id, nullable)
- `assigned_to` (UUID, Foreign Key → users.id, nullable)
- `created_by` (UUID, Foreign Key → users.id)
- `metadata` (JSONB) - Additional case-specific data
- `due_date` (Timestamp, nullable) - SLA deadline
- `resolved_at` (Timestamp, nullable)
- `created_at`, `updated_at` (Timestamps)
- `deleted_at` (Timestamp, nullable) - Soft delete

**RLS Policy**: Users can access cases if:
- Their tenant owns the case (`tenant_id`)
- Their tenant is the originating tenant (`originating_tenant_id`)
- Their tenant is the current handling tenant (`current_tenant_id`)
- Their tenant has an active referral (pending, accepted, or completed)

**Indexes**:
- `tenant_id`, `case_number`
- `(tenant_id, status)`, `(tenant_id, type)`, `(tenant_id, assigned_to)`
- `due_date`, `created_at`

#### `workflows`
Workflow definitions per tenant.

- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key → tenants.id)
- `name` (String)
- `description` (Text, nullable)
- `definition` (JSONB) - Workflow state machine definition
- `version` (Integer)
- `is_active`, `is_default` (Boolean)
- `created_by` (UUID, Foreign Key → users.id, nullable)
- `created_at`, `updated_at` (Timestamps)

**RLS Policy**: Users can only access workflows from their tenant.

#### `workflow_states`
Tracks state transitions for cases.

- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key → cases.id)
- `workflow_id` (UUID, Foreign Key → workflows.id)
- `current_state` (String)
- `previous_state` (String, nullable)
- `transitioned_by` (UUID, Foreign Key → users.id, nullable)
- `transition_notes` (Text, nullable)
- `state_data` (JSONB) - State-specific data
- `transitioned_at` (Timestamp)

**RLS Policy**: Users can only access workflow states for cases in their tenant.

#### `assignments`
Tracks case assignments to users.

- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key → cases.id)
- `assigned_to` (UUID, Foreign Key → users.id)
- `assigned_by` (UUID, Foreign Key → users.id)
- `assignment_type` (String) - 'manual', 'auto', 'escalated'
- `notes` (Text, nullable)
- `assigned_at` (Timestamp)
- `unassigned_at` (Timestamp, nullable)
- `is_active` (Boolean)

**RLS Policy**: Users can only access assignments for cases in their tenant.

#### `case_attachments`
Stores file attachments for cases.

- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key → cases.id)
- `tenant_id` (UUID, Foreign Key → tenants.id)
- `filename` (String)
- `original_filename` (String)
- `mime_type` (String)
- `file_size` (Integer) - Size in bytes
- `file_path` (Text) - Path on filesystem
- `description` (Text, nullable)
- `uploaded_by` (UUID, Foreign Key → users.id)
- `uploaded_at` (Timestamp)
- `deleted_at` (Timestamp, nullable) - Soft delete

**RLS Policy**: Users can access attachments for cases they have access to (via tenant ownership or referral).

#### `case_referrals`
Tracks referrals of cases between organizations.

- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key → cases.id)
- `from_tenant_id` (UUID, Foreign Key → tenants.id) - Referring organization
- `to_tenant_id` (UUID, Foreign Key → tenants.id) - Receiving organization
- `referral_reason` (Text, nullable) - Reason for referral
- `notes` (Text, nullable) - Additional notes
- `status` (String) - 'pending', 'accepted', 'rejected', 'completed', 'cancelled'
- `referred_by` (UUID, Foreign Key → users.id) - User who made the referral
- `accepted_by` (UUID, Foreign Key → users.id, nullable) - User who accepted
- `rejected_by` (UUID, Foreign Key → users.id, nullable) - User who rejected
- `referred_at` (Timestamp) - When referral was created
- `accepted_at` (Timestamp, nullable) - When referral was accepted
- `rejected_at` (Timestamp, nullable) - When referral was rejected
- `completed_at` (Timestamp, nullable) - When referral was completed
- `metadata` (JSONB, nullable) - Additional referral data

**RLS Policy**: Users can access referrals where their tenant is the sender (`from_tenant_id`) or receiver (`to_tenant_id`).

### Audit & Integration Tables

#### `audit_logs`
Immutable audit trail for all operations.

- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key → tenants.id)
- `entity_type` (String) - 'case', 'user', 'workflow', etc.
- `entity_id` (UUID) - ID of the audited entity
- `action` (String) - 'create', 'update', 'delete', 'view', etc.
- `user_id` (UUID, Foreign Key → users.id, nullable)
- `old_values` (JSONB, nullable) - Previous values
- `new_values` (JSONB, nullable) - New values
- `metadata` (JSONB, nullable) - Additional audit data
- `ip_address`, `user_agent` (String, nullable)
- `created_at` (Timestamp)

**RLS Policy**: Users can only access audit logs from their tenant.

**Note**: This table should never be updated or deleted (immutable).

#### `webhooks`
Webhook subscriptions for event notifications.

- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key → tenants.id, nullable)
  - NULL = system-wide webhook
- `name` (String)
- `url` (Text)
- `secret` (String, nullable) - For HMAC signature
- `events` (JSONB) - Array of event types
- `is_active` (Boolean)
- `retry_count` (Integer) - Default: 3
- `timeout_ms` (Integer) - Default: 30000
- `created_by` (UUID, Foreign Key → users.id, nullable)
- `created_at`, `updated_at` (Timestamps)

**RLS Policy**: Users can access webhooks from their tenant or system-wide webhooks.

#### `integrations`
External system integrations.

- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key → tenants.id, nullable)
  - NULL = system-wide integration
- `name` (String)
- `type` (String) - 'api', 'legacy_system', 'webhook'
- `endpoint_url` (Text, nullable)
- `config` (JSONB) - Integration configuration
- `api_key`, `api_secret` (String, nullable) - Encrypted
- `is_active` (Boolean)
- `last_sync_at` (Timestamp, nullable)
- `sync_status` (JSONB, nullable) - Last sync status/error
- `created_by` (UUID, Foreign Key → users.id, nullable)
- `created_at`, `updated_at` (Timestamps)

**RLS Policy**: Users can access integrations from their tenant or system-wide integrations.

## Row Level Security (RLS)

### How It Works

1. **Enable RLS**: All tenant-aware tables have RLS enabled
2. **Set Context**: Before each query, set `app.current_tenant_id` in the PostgreSQL session
3. **Automatic Filtering**: RLS policies automatically filter queries by tenant_id

### RLS Functions

- `current_tenant_id()`: Returns the current tenant_id from session
- `current_user_id()`: Returns the current user_id from session

### RLS Policies

All policies follow the pattern:
```sql
CREATE POLICY tenant_isolation_<table> ON <table>
  FOR ALL
  USING (tenant_id = current_tenant_id());
```

### Bypassing RLS (Super Admin)

For system-wide operations, set:
```sql
SET LOCAL app.is_super_admin = true;
```

**Warning**: Use super admin context with extreme caution. It bypasses all RLS policies.

## Usage Examples

### Setting Tenant Context in Middleware

```javascript
import { setTenantContext } from './middleware/tenant.js';

app.use('/api', authenticate, setTenantContext);
```

### Querying with Tenant Context

```javascript
// With middleware, queries are automatically filtered
const cases = await db('cases').where('status', 'open');
// Only returns cases for the current tenant
```

### Background Jobs

```javascript
import { withTenantContext } from './utils/rls-helpers.js';

await withTenantContext(tenantId, userId, async () => {
  const cases = await db('cases').where('status', 'open');
  // Process cases for this tenant
});
```

## Migration Commands

```bash
# Create and apply a new migration
npm run migrate

# Deploy migrations (production)
npm run migrate:deploy

# Check migration status
npm run migrate:status

# Generate Prisma Client
npm run prisma:generate
```

## Best Practices

1. **Always set tenant context** before querying tenant-aware tables
2. **Never bypass RLS** unless absolutely necessary (super admin operations)
3. **Use transactions** for multi-step operations
4. **Index tenant_id** columns for performance
5. **Audit all operations** - use audit_logs table
6. **Soft delete** sensitive data instead of hard delete

