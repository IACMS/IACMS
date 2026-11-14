-- Give roles a portable, stable claim value independent of this database's UUIDs.
ALTER TABLE "roles" ADD COLUMN "slug" TEXT;

WITH normalized AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''),
      'role'
    ) AS base_slug
  FROM "roles"
), collisions AS (
  SELECT "id", base_slug, count(*) OVER (PARTITION BY base_slug) AS duplicate_count
  FROM normalized
)
UPDATE "roles" AS role
SET "slug" = CASE
  WHEN collisions.duplicate_count > 1
    THEN collisions.base_slug || '-' || replace(role."id"::text, '-', '')
  ELSE collisions.base_slug
END
FROM collisions
WHERE role."id" = collisions."id";

ALTER TABLE "roles" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "roles_slug_key" ON "roles"("slug");

-- Departments are IACMS domain data. Remove them from IAM's active Prisma/API
-- surface while retaining copied rows for rollback and audit purposes.
ALTER TABLE "users" RENAME COLUMN "department_id" TO "legacy_iacms_department_id";
ALTER TABLE "departments" RENAME TO "legacy_iacms_departments";

ALTER INDEX IF EXISTS "users_tenant_id_department_id_idx"
  RENAME TO "users_tenant_id_legacy_iacms_department_id_idx";
ALTER INDEX IF EXISTS "departments_tenant_id_idx"
  RENAME TO "legacy_iacms_departments_tenant_id_idx";
ALTER INDEX IF EXISTS "departments_is_active_idx"
  RENAME TO "legacy_iacms_departments_is_active_idx";
ALTER INDEX IF EXISTS "departments_tenant_id_code_key"
  RENAME TO "legacy_iacms_departments_tenant_id_code_key";
ALTER INDEX IF EXISTS "departments_tenant_id_name_key"
  RENAME TO "legacy_iacms_departments_tenant_id_name_key";
ALTER TABLE "users" RENAME CONSTRAINT "users_department_id_fkey"
  TO "users_legacy_iacms_department_id_fkey";
ALTER TABLE "legacy_iacms_departments" RENAME CONSTRAINT "departments_pkey"
  TO "legacy_iacms_departments_pkey";
ALTER TABLE "legacy_iacms_departments" RENAME CONSTRAINT "departments_tenant_id_fkey"
  TO "legacy_iacms_departments_tenant_id_fkey";
