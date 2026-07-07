-- DropForeignKey
ALTER TABLE "public"."departments" DROP CONSTRAINT "departments_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."users" DROP CONSTRAINT "users_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."workflows" DROP CONSTRAINT "workflows_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."cases" DROP CONSTRAINT "cases_originating_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."cases" DROP CONSTRAINT "cases_current_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."case_sequences" DROP CONSTRAINT "case_sequences_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."case_referrals" DROP CONSTRAINT "case_referrals_from_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."case_referrals" DROP CONSTRAINT "case_referrals_to_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."agency_chat_messages" DROP CONSTRAINT "agency_chat_messages_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."agency_chat_messages" DROP CONSTRAINT "agency_chat_messages_recipient_department_id_fkey";

-- DropIndex
DROP INDEX "public"."users_tenant_id_department_id_idx";

-- DropIndex
DROP INDEX "public"."workflows_tenant_id_idx";

-- DropIndex
DROP INDEX "public"."workflows_tenant_id_department_id_idx";

-- DropIndex
DROP INDEX "public"."workflows_tenant_id_is_active_idx";

-- DropIndex
DROP INDEX "public"."cases_current_tenant_id_current_department_id_referral_stat_idx";

-- DropIndex
DROP INDEX "public"."cases_originating_tenant_id_idx";

-- DropIndex
DROP INDEX "public"."cases_current_tenant_id_idx";

-- DropIndex
DROP INDEX "public"."cases_referral_status_idx";

-- DropIndex
DROP INDEX "public"."case_referrals_to_tenant_id_to_department_id_status_referre_idx";

-- DropIndex
DROP INDEX "public"."case_referrals_case_id_status_idx";

-- DropIndex
DROP INDEX "public"."audit_logs_tenant_id_idx";

-- DropIndex
DROP INDEX "public"."audit_logs_related_tenant_id_idx";

-- DropIndex
DROP INDEX "public"."audit_logs_entity_type_entity_id_idx";

-- DropIndex
DROP INDEX "public"."audit_logs_user_id_idx";

-- DropIndex
DROP INDEX "public"."audit_logs_action_idx";

-- DropIndex
DROP INDEX "public"."audit_logs_created_at_idx";

-- DropIndex
DROP INDEX "public"."audit_logs_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX "public"."agency_chat_messages_tenant_id_department_id_created_at_idx";

-- AlterTable
ALTER TABLE "public"."users" DROP COLUMN "department_id";

-- AlterTable
ALTER TABLE "public"."workflows" DROP COLUMN "department_id";

-- AlterTable
ALTER TABLE "public"."workflow_steps" ALTER COLUMN "allowed_role_ids" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."workflow_transitions" ALTER COLUMN "allowed_role_ids" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."cases" DROP COLUMN "current_department_id",
DROP COLUMN "originating_department_id";

-- AlterTable
ALTER TABLE "public"."case_sequences" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."case_referrals" DROP COLUMN "from_department_id",
DROP COLUMN "to_department_id";

-- AlterTable
ALTER TABLE "public"."agency_chat_messages" DROP COLUMN "department_id",
DROP COLUMN "recipient_department_id";

-- DropTable
DROP TABLE "public"."departments";

-- CreateIndex
CREATE INDEX "workflows_tenant_id_is_default_idx" ON "public"."workflows"("tenant_id" ASC, "is_default" ASC);

