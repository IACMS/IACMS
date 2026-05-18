-- AlterTable
ALTER TABLE "workflow_transitions" ADD COLUMN "time_limit_minutes" INTEGER,
ADD COLUMN "time_limit_type" TEXT NOT NULL DEFAULT 'NONE';
