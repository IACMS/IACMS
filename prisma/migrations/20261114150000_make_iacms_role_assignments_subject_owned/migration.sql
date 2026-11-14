-- IACMS role assignments are keyed by stable IAM subject UUIDs, but the
-- assignment table is owned by IACMS. Remove only the cross-ownership user
-- foreign keys; keep role integrity and all assignment rows unchanged.
ALTER TABLE "user_roles"
  DROP CONSTRAINT IF EXISTS "user_roles_user_id_fkey";

ALTER TABLE "user_roles"
  DROP CONSTRAINT IF EXISTS "user_roles_assigned_by_fkey";
