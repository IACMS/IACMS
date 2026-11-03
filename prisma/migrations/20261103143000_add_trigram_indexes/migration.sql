-- =============================================================================
-- Migration: 20261103143000_add_trigram_indexes
-- Enables pg_trgm extension and creates GIN trigram indexes for high-speed ILIKE text search.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Audit logs text search (action)
CREATE INDEX IF NOT EXISTS "audit_logs_action_trgm_idx"
  ON "audit_logs" USING gin ("action" gin_trgm_ops);

-- 2. Case text search (title, case_number)
CREATE INDEX IF NOT EXISTS "cases_title_trgm_idx"
  ON "cases" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "cases_case_number_trgm_idx"
  ON "cases" USING gin ("case_number" gin_trgm_ops);

-- 3. User text search (email, full name)
CREATE INDEX IF NOT EXISTS "users_email_trgm_idx"
  ON "users" USING gin ("email" gin_trgm_ops);

