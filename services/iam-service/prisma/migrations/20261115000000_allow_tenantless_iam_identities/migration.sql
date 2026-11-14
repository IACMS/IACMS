-- IAM identities may exist without membership in a legacy IACMS tenant.
-- Existing rows and their subject UUIDs remain unchanged.
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_fkey";
ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL;
ALTER TABLE "users"
  ADD CONSTRAINT "users_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma cannot express a partial unique index. This prevents duplicate email
-- addresses among global identities while preserving historical tenant-local
-- uniqueness and cross-tenant duplicates already in the system.
CREATE UNIQUE INDEX "users_global_email_key"
  ON "users" (lower("email"))
  WHERE "tenant_id" IS NULL;
