-- IACMS-owned local read model for IAM identities. No cross-database FK is used.
CREATE TABLE "identity_projection" (
    "subject_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "department_id" UUID,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_version" BIGINT NOT NULL DEFAULT 0,
    "source_updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "projected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "identity_projection_pkey" PRIMARY KEY ("subject_id", "tenant_id")
);
CREATE INDEX "identity_projection_tenant_id_is_active_idx" ON "identity_projection"("tenant_id", "is_active");
CREATE INDEX "identity_projection_department_id_idx" ON "identity_projection"("department_id");
-- Backfill without altering the legacy users table; existing UUID references remain valid.
INSERT INTO "identity_projection" (
  "subject_id", "tenant_id", "department_id", "email", "username", "first_name", "last_name", "phone", "is_active", "source_updated_at", "projected_at"
)
SELECT "id", "tenant_id", "department_id", "email", "username", "first_name", "last_name", "phone", "is_active", "updated_at", CURRENT_TIMESTAMP
FROM "users"
ON CONFLICT ("subject_id", "tenant_id") DO NOTHING;
