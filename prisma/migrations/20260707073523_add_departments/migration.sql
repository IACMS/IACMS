-- Department layer: sub-units within each tenant.

ALTER TABLE "agency_chat_messages"
  ADD COLUMN IF NOT EXISTS "department_id" UUID,
  ADD COLUMN IF NOT EXISTS "recipient_department_id" UUID;

ALTER TABLE "case_referrals"
  ADD COLUMN IF NOT EXISTS "from_department_id" UUID,
  ADD COLUMN IF NOT EXISTS "to_department_id" UUID;

ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "current_department_id" UUID,
  ADD COLUMN IF NOT EXISTS "originating_department_id" UUID;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "department_id" UUID;

ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "department_id" UUID;

CREATE TABLE IF NOT EXISTS "departments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "departments_tenant_id_idx" ON "departments"("tenant_id");
CREATE INDEX IF NOT EXISTS "departments_is_active_idx" ON "departments"("is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "departments_tenant_id_code_key" ON "departments"("tenant_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "departments_tenant_id_name_key" ON "departments"("tenant_id", "name");

CREATE INDEX IF NOT EXISTS "agency_chat_messages_tenant_id_department_id_created_at_idx"
  ON "agency_chat_messages"("tenant_id", "department_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "case_referrals_to_tenant_id_to_department_id_status_referre_idx"
  ON "case_referrals"("to_tenant_id", "to_department_id", "status", "referred_at" DESC);

CREATE INDEX IF NOT EXISTS "cases_current_tenant_id_current_department_id_referral_stat_idx"
  ON "cases"("current_tenant_id", "current_department_id", "referral_status");

CREATE INDEX IF NOT EXISTS "users_tenant_id_department_id_idx" ON "users"("tenant_id", "department_id");
CREATE INDEX IF NOT EXISTS "workflows_tenant_id_department_id_idx" ON "workflows"("tenant_id", "department_id");

DO $$ BEGIN
  ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "workflows" ADD CONSTRAINT "workflows_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cases" ADD CONSTRAINT "cases_originating_department_id_fkey"
    FOREIGN KEY ("originating_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cases" ADD CONSTRAINT "cases_current_department_id_fkey"
    FOREIGN KEY ("current_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "case_referrals" ADD CONSTRAINT "case_referrals_from_department_id_fkey"
    FOREIGN KEY ("from_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "case_referrals" ADD CONSTRAINT "case_referrals_to_department_id_fkey"
    FOREIGN KEY ("to_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agency_chat_messages" ADD CONSTRAINT "agency_chat_messages_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agency_chat_messages" ADD CONSTRAINT "agency_chat_messages_recipient_department_id_fkey"
    FOREIGN KEY ("recipient_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
