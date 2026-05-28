-- AlterTable
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "registered_by_user_id" UUID;

-- AddForeignKey (nullable registrar)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_registered_by_user_id_fkey'
  ) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_registered_by_user_id_fkey"
      FOREIGN KEY ("registered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
