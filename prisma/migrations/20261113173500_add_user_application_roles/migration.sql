-- AlterTable
ALTER TABLE "oauth_clients" ADD COLUMN IF NOT EXISTS "target_audience" VARCHAR(255);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_application_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "oauth_client_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "user_application_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_application_roles_user_id_idx" ON "user_application_roles"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_application_roles_oauth_client_id_idx" ON "user_application_roles"("oauth_client_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_application_roles_role_id_idx" ON "user_application_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_application_roles_user_id_oauth_client_id_role_id_key" ON "user_application_roles"("user_id", "oauth_client_id", "role_id");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_application_roles_user_id_fkey') THEN
        ALTER TABLE "user_application_roles" ADD CONSTRAINT "user_application_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_application_roles_oauth_client_id_fkey') THEN
        ALTER TABLE "user_application_roles" ADD CONSTRAINT "user_application_roles_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_application_roles_role_id_fkey') THEN
        ALTER TABLE "user_application_roles" ADD CONSTRAINT "user_application_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_application_roles_assigned_by_fkey') THEN
        ALTER TABLE "user_application_roles" ADD CONSTRAINT "user_application_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

