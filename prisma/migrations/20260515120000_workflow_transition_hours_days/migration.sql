-- Switch from minutes to amount + unit (HOURS | DAYS only).
ALTER TABLE "workflow_transitions" DROP COLUMN IF EXISTS "time_limit_minutes";

ALTER TABLE "workflow_transitions" ADD COLUMN "time_limit_amount" INTEGER;
ALTER TABLE "workflow_transitions" ADD COLUMN "time_limit_unit" TEXT;
