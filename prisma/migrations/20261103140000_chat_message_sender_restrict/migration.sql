-- =============================================================================
-- Migration: 20261103140000_chat_message_sender_restrict
-- Changes foreign key chat_messages_sender_id_fkey from ON DELETE CASCADE to ON DELETE RESTRICT
-- to preserve historical chat messages when user accounts are deleted.
-- =============================================================================

ALTER TABLE "chat_messages"
  DROP CONSTRAINT IF EXISTS "chat_messages_sender_id_fkey";

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_sender_id_fkey"
  FOREIGN KEY ("sender_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

