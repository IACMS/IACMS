-- CreateTable
CREATE TABLE "oauth_providers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "client_id" VARCHAR(255) NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "federated_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "federated_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oauth_providers_tenant_id_idx" ON "oauth_providers"("tenant_id");

-- CreateIndex
CREATE INDEX "oauth_providers_is_active_idx" ON "oauth_providers"("is_active");

-- CreateIndex
CREATE INDEX "federated_identities_user_id_idx" ON "federated_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "federated_identities_provider_id_external_id_key" ON "federated_identities"("provider_id", "external_id");

-- AddForeignKey
ALTER TABLE "oauth_providers" ADD CONSTRAINT "oauth_providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_identities" ADD CONSTRAINT "federated_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_identities" ADD CONSTRAINT "federated_identities_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "oauth_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index for tenant-scoped providers
CREATE UNIQUE INDEX "uq_oauth_provider_tenant" ON "oauth_providers" ("tenant_id", "provider") WHERE "tenant_id" IS NOT NULL;

-- Partial unique index for platform-level providers (where tenant_id IS NULL)
CREATE UNIQUE INDEX "uq_oauth_provider_platform" ON "oauth_providers" ("provider") WHERE "tenant_id" IS NULL;
