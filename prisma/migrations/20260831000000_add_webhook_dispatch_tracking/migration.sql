-- Migration: Add webhook dispatch tracking to audit_outbox
-- Allows the webhook dispatcher worker to track which outbox records have
-- been delivered to partner webhook endpoints, independently from the Kafka
-- published flag.

ALTER TABLE "audit_outbox"
  ADD COLUMN IF NOT EXISTS "webhook_dispatched"     BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "webhook_dispatched_at"  TIMESTAMP;

-- Composite index used by the dispatcher's poll query:
--   WHERE published = true AND webhook_dispatched = false
CREATE INDEX IF NOT EXISTS "audit_outbox_webhook_dispatched_published_created_at_idx"
  ON "audit_outbox" ("webhook_dispatched", "published", "created_at");
