-- DropForeignKey
ALTER TABLE "case_history" DROP CONSTRAINT "case_history_to_step_id_fkey";

-- DropIndex
DROP INDEX "workflow_steps_workflow_id_idx";

-- DropIndex
DROP INDEX "workflow_transitions_workflow_id_idx";

-- DropIndex
DROP INDEX "workflows_tenant_id_is_default_idx";

-- AlterTable
ALTER TABLE "agency_chat_messages" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "recipient_department_id" UUID;

-- AlterTable
ALTER TABLE "case_referrals" ADD COLUMN     "from_department_id" UUID,
ADD COLUMN     "to_department_id" UUID;

-- AlterTable
ALTER TABLE "case_sequences" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "current_department_id" UUID,
ADD COLUMN     "originating_department_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "department_id" UUID;

-- AlterTable
ALTER TABLE "workflow_steps" ALTER COLUMN "allowed_role_ids" SET DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "workflow_transitions" ALTER COLUMN "allowed_role_ids" SET DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "department_id" UUID;

-- CreateTable
CREATE TABLE "departments" (
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

-- CreateIndex
CREATE INDEX "departments_tenant_id_idx" ON "departments"("tenant_id");

-- CreateIndex
CREATE INDEX "departments_is_active_idx" ON "departments"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_code_key" ON "departments"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_name_key" ON "departments"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "agency_chat_messages_tenant_id_department_id_created_at_idx" ON "agency_chat_messages"("tenant_id", "department_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "case_referrals_to_tenant_id_to_department_id_status_referre_idx" ON "case_referrals"("to_tenant_id", "to_department_id", "status", "referred_at" DESC);

-- CreateIndex
CREATE INDEX "cases_current_tenant_id_current_department_id_referral_stat_idx" ON "cases"("current_tenant_id", "current_department_id", "referral_status");

-- CreateIndex
CREATE INDEX "cases_originating_tenant_id_idx" ON "cases"("originating_tenant_id");

-- CreateIndex
CREATE INDEX "cases_current_tenant_id_idx" ON "cases"("current_tenant_id");

-- CreateIndex
CREATE INDEX "cases_referral_status_idx" ON "cases"("referral_status");

-- CreateIndex
CREATE INDEX "users_tenant_id_department_id_idx" ON "users"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "workflows_tenant_id_idx" ON "workflows"("tenant_id");

-- CreateIndex
CREATE INDEX "workflows_tenant_id_department_id_idx" ON "workflows"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "workflows_tenant_id_is_active_idx" ON "workflows"("tenant_id", "is_active");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_originating_department_id_fkey" FOREIGN KEY ("originating_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_department_id_fkey" FOREIGN KEY ("current_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_referrals" ADD CONSTRAINT "case_referrals_from_department_id_fkey" FOREIGN KEY ("from_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_referrals" ADD CONSTRAINT "case_referrals_to_department_id_fkey" FOREIGN KEY ("to_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_chat_messages" ADD CONSTRAINT "agency_chat_messages_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_chat_messages" ADD CONSTRAINT "agency_chat_messages_recipient_department_id_fkey" FOREIGN KEY ("recipient_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
