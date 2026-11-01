-- CreateTable
CREATE TABLE "oidc_payloads" (
    "id" VARCHAR(255) NOT NULL,
    "model_name" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "grant_id" VARCHAR(255),
    "user_code" VARCHAR(255),
    "uid" VARCHAR(255),
    "expires_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" UUID NOT NULL,
    "client_id" VARCHAR(255) NOT NULL,
    "client_secret_ciphertext" TEXT,
    "name" VARCHAR(255) NOT NULL,
    "tenant_id" UUID,
    "redirect_uris" JSONB NOT NULL,
    "grant_types" JSONB NOT NULL,
    "response_types" JSONB NOT NULL,
    "scope" TEXT NOT NULL,
    "token_endpoint_auth_method" VARCHAR(64) NOT NULL DEFAULT 'client_secret_basic',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "scopes" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oidc_payloads_grant_id_idx" ON "oidc_payloads"("grant_id");

-- CreateIndex
CREATE INDEX "oidc_payloads_user_code_idx" ON "oidc_payloads"("user_code");

-- CreateIndex
CREATE INDEX "oidc_payloads_uid_idx" ON "oidc_payloads"("uid");

-- CreateIndex
CREATE INDEX "oidc_payloads_model_name_expires_at_idx" ON "oidc_payloads"("model_name", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "oauth_clients"("client_id");

-- CreateIndex
CREATE INDEX "oauth_clients_tenant_id_idx" ON "oauth_clients"("tenant_id");

-- CreateIndex
CREATE INDEX "oauth_clients_is_active_idx" ON "oauth_clients"("is_active");

-- CreateIndex
CREATE INDEX "oauth_consents_user_id_idx" ON "oauth_consents"("user_id");

-- CreateIndex
CREATE INDEX "oauth_consents_client_id_idx" ON "oauth_consents"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_consents_user_id_client_id_key" ON "oauth_consents"("user_id", "client_id");

-- AddForeignKey
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
