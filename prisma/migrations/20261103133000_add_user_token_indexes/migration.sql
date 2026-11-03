-- =============================================================================
-- Migration: 20261103133000_add_user_token_indexes
-- Indexes for reset_password_token and email_verification_token on users table.
-- =============================================================================

CREATE INDEX IF NOT EXISTS "users_reset_password_token_idx"
  ON "users"("reset_password_token");

CREATE INDEX IF NOT EXISTS "users_email_verification_token_idx"
  ON "users"("email_verification_token");

