-- =============================================================================
-- Migration: 20261103130000_add_tenant_id_to_files
-- Adds tenant_id to files and chunk_uploads tables for multi-tenant isolation.
-- =============================================================================

-- 1. Add tenant_id to files
ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "tenant_id" UUID;

ALTER TABLE "files"
  ADD CONSTRAINT "files_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "files_tenant_id_idx"
  ON "files"("tenant_id");

-- 2. Add tenant_id to chunk_uploads
ALTER TABLE "chunk_uploads"
  ADD COLUMN IF NOT EXISTS "tenant_id" UUID;

ALTER TABLE "chunk_uploads"
  ADD CONSTRAINT "chunk_uploads_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "chunk_uploads_tenant_id_idx"
  ON "chunk_uploads"("tenant_id");

