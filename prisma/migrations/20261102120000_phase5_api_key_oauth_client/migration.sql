-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN "oauth_client_id" UUID;

-- CreateIndex
CREATE INDEX "api_keys_oauth_client_id_idx" ON "api_keys"("oauth_client_id");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "oauth_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

