-- Repair: workflow_transitions missing requires_attachment on DBs where
-- multi_tenant_workflow_engine was marked applied before this column existed.

ALTER TABLE "workflow_transitions"
  ADD COLUMN IF NOT EXISTS "requires_attachment" BOOLEAN NOT NULL DEFAULT false;
