-- Migration: Create audit_outbox and add webhook dispatch tracking
-- Allows the webhook dispatcher worker to track which outbox records have
-- been delivered to partner webhook endpoints, independently from the Kafka
-- published flag.

CREATE TABLE "audit_outbox" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "webhook_dispatched" BOOLEAN NOT NULL DEFAULT false,
    "webhook_dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_outbox_published_created_at_idx" ON "audit_outbox"("published", "created_at");
CREATE INDEX "audit_outbox_webhook_dispatched_published_created_at_idx" ON "audit_outbox"("webhook_dispatched", "published", "created_at");

