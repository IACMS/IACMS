-- Agency-internal chat (tenant-scoped)

CREATE TABLE IF NOT EXISTS "agency_chat_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agency_chat_messages_tenant_id_created_at_idx"
    ON "agency_chat_messages"("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "agency_chat_messages_tenant_id_recipient_id_idx"
    ON "agency_chat_messages"("tenant_id", "recipient_id");

CREATE INDEX IF NOT EXISTS "agency_chat_messages_sender_id_recipient_id_idx"
    ON "agency_chat_messages"("sender_id", "recipient_id");

DO $$ BEGIN
    ALTER TABLE "agency_chat_messages" ADD CONSTRAINT "agency_chat_messages_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "agency_chat_messages" ADD CONSTRAINT "agency_chat_messages_sender_id_fkey"
        FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "agency_chat_messages" ADD CONSTRAINT "agency_chat_messages_recipient_id_fkey"
        FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
