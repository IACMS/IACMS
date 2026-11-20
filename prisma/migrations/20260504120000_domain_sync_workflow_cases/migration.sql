-- Sync database with prisma/schema.prisma: workflow steps/transitions, case history/sequences,
-- workflow status + key, case workflow versioning. Safe backfills for existing rows.

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- DropForeignKey
ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_workflow_id_fkey";

-- DropForeignKey
ALTER TABLE "workflow_states" DROP CONSTRAINT IF EXISTS "workflow_states_case_id_fkey";

-- DropForeignKey
ALTER TABLE "workflow_states" DROP CONSTRAINT IF EXISTS "workflow_states_transitioned_by_fkey";

-- DropForeignKey
ALTER TABLE "workflow_states" DROP CONSTRAINT IF EXISTS "workflow_states_workflow_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "audit_logs_action_idx";

-- DropIndex
DROP INDEX IF EXISTS "audit_logs_created_at_idx";

-- DropIndex
DROP INDEX IF EXISTS "audit_logs_entity_type_entity_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "audit_logs_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX IF EXISTS "audit_logs_tenant_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "audit_logs_user_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "case_referrals_from_tenant_id_status_idx";

-- DropIndex
DROP INDEX IF EXISTS "case_referrals_to_tenant_id_status_idx";

-- DropIndex
DROP INDEX IF EXISTS "cases_case_number_idx";

-- DropIndex
DROP INDEX IF EXISTS "cases_case_number_key";

-- DropIndex
DROP INDEX IF EXISTS "cases_current_tenant_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "cases_originating_tenant_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "cases_referral_status_idx";

-- DropIndex
DROP INDEX IF EXISTS "cases_tenant_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "workflows_tenant_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "workflows_tenant_id_is_active_idx";

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "related_tenant_id" UUID;

-- AlterTable (cases: add columns first; workflow_id NOT NULL applied after backfill)
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "current_step_id" UUID;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "workflow_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable (workflows: key backfill before NOT NULL)
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "workflows" ALTER COLUMN "definition" DROP NOT NULL;
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "key" TEXT;

UPDATE "workflows" SET "key" = 'migrated-' || REPLACE("id"::text, '-', '')
WHERE "key" IS NULL;

ALTER TABLE "workflows" ALTER COLUMN "key" SET NOT NULL;

-- Drop legacy workflow state tracking (replaced by case current_step + history)
DROP TABLE IF EXISTS "workflow_states";

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_initial" BOOLEAN NOT NULL DEFAULT false,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "allowed_role_ids" UUID[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "from_step_id" UUID NOT NULL,
    "to_step_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowed_role_ids" UUID[],
    "requires_comment" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_history" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transition_id" UUID,
    "from_step_id" UUID,
    "to_step_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "comment" TEXT,
    "transitioned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_sequences" (
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_sequences_pkey" PRIMARY KEY ("tenant_id","year")
);

-- Backfill cases.workflow_id from any workflow in the same tenant, then drop rows that cannot be satisfied
UPDATE "cases" c
SET "workflow_id" = w."id"
FROM (
  SELECT DISTINCT ON ("tenant_id") "tenant_id", "id"
  FROM "workflows"
  ORDER BY "tenant_id", "created_at" ASC
) w
WHERE c."workflow_id" IS NULL AND c."tenant_id" = w."tenant_id";

DELETE FROM "cases" WHERE "workflow_id" IS NULL;

ALTER TABLE "cases" ALTER COLUMN "workflow_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_workflow_id_key_key" ON "workflow_steps"("workflow_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transitions_workflow_id_from_step_id_name_key" ON "workflow_transitions"("workflow_id", "from_step_id", "name");

-- CreateIndex
CREATE INDEX "case_history_case_id_transitioned_at_idx" ON "case_history"("case_id", "transitioned_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_created_at_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_related_tenant_id_entity_type_entity_id_created__idx" ON "audit_logs"("related_tenant_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_user_id_created_at_idx" ON "audit_logs"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "case_referrals_from_tenant_id_status_referred_at_idx" ON "case_referrals"("from_tenant_id", "status", "referred_at" DESC);

-- CreateIndex
CREATE INDEX "case_referrals_to_tenant_id_status_referred_at_idx" ON "case_referrals"("to_tenant_id", "status", "referred_at" DESC);

-- CreateIndex
CREATE INDEX "cases_tenant_id_current_step_id_idx" ON "cases"("tenant_id", "current_step_id");

-- CreateIndex
CREATE INDEX "cases_tenant_id_workflow_id_closed_at_idx" ON "cases"("tenant_id", "workflow_id", "closed_at");

-- CreateIndex
CREATE INDEX "cases_originating_tenant_id_referral_status_idx" ON "cases"("originating_tenant_id", "referral_status");

-- CreateIndex
CREATE UNIQUE INDEX "cases_tenant_id_case_number_key" ON "cases"("tenant_id", "case_number");

-- CreateIndex
CREATE INDEX "workflows_tenant_id_key_status_idx" ON "workflows"("tenant_id", "key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_tenant_id_key_version_key" ON "workflows"("tenant_id", "key", "version");

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_from_step_id_fkey" FOREIGN KEY ("from_step_id") REFERENCES "workflow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_to_step_id_fkey" FOREIGN KEY ("to_step_id") REFERENCES "workflow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_step_id_fkey" FOREIGN KEY ("current_step_id") REFERENCES "workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_history" ADD CONSTRAINT "case_history_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_history" ADD CONSTRAINT "case_history_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "workflow_transitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_history" ADD CONSTRAINT "case_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_related_tenant_id_fkey" FOREIGN KEY ("related_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
