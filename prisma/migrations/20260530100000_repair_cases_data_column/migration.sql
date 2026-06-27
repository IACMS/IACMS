-- Repair: multi_tenant_workflow_engine failed mid-apply when WorkflowStatus already existed.
-- Adds any columns that may be missing on partially-migrated dev databases.

ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "data" JSONB;
