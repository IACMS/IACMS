# Prisma Migration Guide

This document explains how the project was migrated from Knex.js to Prisma and how to use Prisma going forward.

## Migration Summary

The project has been migrated from Knex.js to Prisma ORM. The database schema remains the same, but the way we interact with it has changed.

## What Changed

### 1. Database Client
- **Before**: Knex.js query builder
- **After**: Prisma Client (type-safe ORM)

### 2. Configuration
- **Before**: `src/config/database.js` exported Knex instance
- **After**: `src/config/database.js` exports Prisma Client instance

### 3. Middleware
- **Before**: Used `db.raw()` for RLS context
- **After**: Uses `prisma.$executeRaw` for RLS context

### 4. Models
- **Before**: Manual query building with Knex
- **After**: Prisma Client methods with automatic type inference

## Prisma Schema

The Prisma schema is located at `prisma/schema.prisma`. This file defines:
- All database models (tables)
- Relationships between models
- Indexes and constraints
- Field types and defaults

## Environment Variables

Make sure your `.env` file includes:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iacms?schema=public"
```

Or construct it from individual variables:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=iacms
DB_USER=postgres
DB_PASSWORD=postgres
```

The `src/config/database.js` will automatically construct `DATABASE_URL` if it's not set.

## Row Level Security (RLS)

RLS still works the same way. The middleware sets the tenant context before queries:

```javascript
import { setTenantContextMiddleware } from './middleware/tenant.js';

app.use('/api', setTenantContextMiddleware);
```

This sets `app.current_tenant_id` in the PostgreSQL session, which RLS policies use to filter data.

## Using Prisma

### Basic Queries

```javascript
import prisma from '../config/database.js';

// Find all users
const users = await prisma.user.findMany();

// Find user by ID
const user = await prisma.user.findUnique({
  where: { id: userId }
});

// Create user
const newUser = await prisma.user.create({
  data: {
    email: 'user@example.com',
    tenantId: tenantId,
    // ... other fields
  }
});

// Update user
const updatedUser = await prisma.user.update({
  where: { id: userId },
  data: { email: 'newemail@example.com' }
});

// Delete user
await prisma.user.delete({
  where: { id: userId }
});
```

### Relationships

Prisma automatically handles relationships:

```javascript
// Get user with tenant and roles
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    tenant: true,
    userRoles: {
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true
              }
            }
          }
        }
      }
    }
  }
});
```

### Raw SQL

For complex queries or RLS context, use raw SQL:

```javascript
// Set tenant context
await prisma.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}`;

// Raw query
const result = await prisma.$queryRaw`
  SELECT * FROM cases 
  WHERE tenant_id = ${tenantId} 
  AND status = 'open'
`;
```

### Transactions

```javascript
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({
    data: userData
  });
  
  await tx.userRole.create({
    data: {
      userId: user.id,
      roleId: roleId
    }
  });
  
  return user;
});
```

## Prisma Commands

### Generate Prisma Client
```bash
npm run prisma:generate
# or
npx prisma generate
```

### Format Schema
```bash
npm run prisma:format
# or
npx prisma format
```

### Validate Schema
```bash
npm run prisma:validate
# or
npx prisma validate
```

### Prisma Studio (Database GUI)
```bash
npm run studio
# or
npx prisma studio
```

### Introspect Existing Database
If you need to update the schema from an existing database:
```bash
npm run prisma:db:pull
# or
npx prisma db pull
```

## Migrations

**Note**: Knex migrations have been removed. All migrations now use Prisma. The database schema is managed through `prisma/schema.prisma`.

### Using Prisma Migrations (Future)

```bash
# Create a migration
npm run migrate
# or
npx prisma migrate dev --name migration_name

# Deploy migrations (production)
npm run migrate:deploy
# or
npx prisma migrate deploy
```

## Example Model

See `src/models/User.js` for an example of how to structure models with Prisma.

## Benefits of Prisma

1. **Type Safety**: Auto-generated types for all models
2. **Relationships**: Automatic handling of joins and relationships
3. **Developer Experience**: Better error messages and IDE support
4. **Query Builder**: Clean, intuitive API
5. **Migrations**: Built-in migration system (when needed)

## Troubleshooting

### Prisma Client Not Generated
```bash
npx prisma generate
```

### Schema Out of Sync
```bash
# Pull schema from database
npx prisma db pull

# Or push schema to database (development only)
npx prisma db push
```

### Connection Issues
- Check `DATABASE_URL` in `.env`
- Verify PostgreSQL is running
- Check database credentials

## Next Steps

1. Create models for other entities (Case, Workflow, etc.)
2. Update controllers to use Prisma models
3. Consider using Prisma migrations for future schema changes
4. ✅ Knex.js has been completely removed from the project

