-- =============================================================================
-- Migration: db_hardening
-- Applies 4 fixes identified in the IACMS database review:
--   1. Drop Role.user_id phantom column
--   2. Add CaseStatus, CasePriority, ReferralStatus enums + convert columns
--   3. Rename Integration.api_key / api_secret → api_key_enc / api_secret_enc
--   4. Add CaseAttachment.file_id nullable FK → files.id
-- =============================================================================

-- ---------------------------------------------------------------------------
-- FIX 1: Drop phantom Role.user_id column
-- No data is lost — no application code reads or writes this column.
-- ---------------------------------------------------------------------------
ALTER TABLE "roles" DROP COLUMN IF EXISTS "user_id";


-- ---------------------------------------------------------------------------
-- FIX 2: Enum columns for Case status / priority / referral_status
-- ---------------------------------------------------------------------------

-- 2a. Create the enum types
DO $$ BEGIN
  CREATE TYPE "case_status" AS ENUM ('open', 'in_progress', 'closed');
EXCEPTION
  WHEN duplicate_object THEN
    BEGIN
      ALTER TYPE "case_status" ADD VALUE IF NOT EXISTS 'in_progress';
    EXCEPTION WHEN OTHERS THEN null; END;
END $$;

DO $$ BEGIN
  CREATE TYPE "case_priority" AS ENUM ('low', 'normal', 'high', 'urgent', 'critical');
EXCEPTION
  WHEN duplicate_object THEN
    BEGIN
      ALTER TYPE "case_priority" ADD VALUE IF NOT EXISTS 'critical';
    EXCEPTION WHEN OTHERS THEN null; END;
END $$;

DO $$ BEGIN
  CREATE TYPE "referral_status_enum" AS ENUM ('none', 'pending', 'pending_referral', 'accepted', 'rejected', 'completed');
EXCEPTION
  WHEN duplicate_object THEN
    BEGIN
      ALTER TYPE "referral_status_enum" ADD VALUE IF NOT EXISTS 'pending_referral';
    EXCEPTION WHEN OTHERS THEN null; END;
END $$;

-- 2b. Convert Case.status  (existing values: 'open', 'closed')
ALTER TABLE "cases" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "cases"
  ALTER COLUMN "status"
  TYPE "case_status"
  USING "status"::"case_status";
ALTER TABLE "cases"
  ALTER COLUMN "status" SET DEFAULT 'open'::"case_status";

-- 2c. Convert Case.priority  (existing values: 'low', 'normal', 'high', 'urgent')
ALTER TABLE "cases" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "cases"
  ALTER COLUMN "priority"
  TYPE "case_priority"
  USING "priority"::"case_priority";
ALTER TABLE "cases"
  ALTER COLUMN "priority" SET DEFAULT 'normal'::"case_priority";

-- 2d. Convert Case.referral_status  (existing values: 'none', 'pending', 'accepted', 'rejected', 'completed')
ALTER TABLE "cases" ALTER COLUMN "referral_status" DROP DEFAULT;
ALTER TABLE "cases"
  ALTER COLUMN "referral_status"
  TYPE "referral_status_enum"
  USING "referral_status"::"referral_status_enum";
ALTER TABLE "cases"
  ALTER COLUMN "referral_status" SET DEFAULT 'none'::"referral_status_enum";

-- 2e. Convert CaseReferral.status  (existing values: 'pending', 'accepted', 'rejected', 'completed')
-- Drop partial index that references status as text
DROP INDEX IF EXISTS "case_referrals_one_active_per_case";

ALTER TABLE "case_referrals" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "case_referrals"
  ALTER COLUMN "status"
  TYPE "referral_status_enum"
  USING "status"::"referral_status_enum";
ALTER TABLE "case_referrals"
  ALTER COLUMN "status" SET DEFAULT 'pending'::"referral_status_enum";

-- Recreate partial index with enum types
CREATE UNIQUE INDEX IF NOT EXISTS "case_referrals_one_active_per_case"
  ON "case_referrals" ("case_id")
  WHERE ("status" IN ('pending'::"referral_status_enum", 'accepted'::"referral_status_enum"));


-- ---------------------------------------------------------------------------
-- FIX 3: Rename Integration secrets columns to signal encryption
-- Existing plaintext values are migrated into the new columns as-is.
-- The application layer will encrypt new writes going forward.
-- ---------------------------------------------------------------------------
ALTER TABLE "integrations" RENAME COLUMN "api_key"    TO "api_key_enc";
ALTER TABLE "integrations" RENAME COLUMN "api_secret" TO "api_secret_enc";

-- Widen to TEXT to match OAuthProvider pattern for ciphertext storage
ALTER TABLE "integrations"
  ALTER COLUMN "api_key_enc"    TYPE TEXT USING "api_key_enc"::TEXT;
ALTER TABLE "integrations"
  ALTER COLUMN "api_secret_enc" TYPE TEXT USING "api_secret_enc"::TEXT;


-- ---------------------------------------------------------------------------
-- FIX 4: Add nullable file_id FK on case_attachments → files
-- Nullable so existing rows are not broken; new uploads should populate it.
-- ---------------------------------------------------------------------------
ALTER TABLE "case_attachments"
  ADD COLUMN IF NOT EXISTS "file_id" UUID;

ALTER TABLE "case_attachments"
  ADD CONSTRAINT "case_attachments_file_id_fkey"
  FOREIGN KEY ("file_id")
  REFERENCES "files"("id")
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "case_attachments_file_id_idx"
  ON "case_attachments"("file_id");

