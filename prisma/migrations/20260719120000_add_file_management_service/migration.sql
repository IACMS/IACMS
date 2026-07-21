-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'SCANNING', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "ChunkUploadStatus" AS ENUM ('IN_PROGRESS', 'MERGING', 'COMPLETE', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "original_name" TEXT NOT NULL,
    "stored_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'minio',
    "compressed" BOOLEAN NOT NULL DEFAULT false,
    "compression_type" TEXT,
    "compress_requested" BOOLEAN NOT NULL DEFAULT false,
    "thumbnails" JSONB,
    "metadata" JSONB,
    "retention_days" INTEGER,
    "scheduled_delete_at" TIMESTAMP(3),
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "retry_at" TIMESTAMP(3),
    "version_of" UUID,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunk_uploads" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "total_size" BIGINT NOT NULL,
    "total_chunks" INTEGER NOT NULL,
    "received_chunks" INTEGER NOT NULL DEFAULT 0,
    "chunk_size" INTEGER NOT NULL,
    "status" "ChunkUploadStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "temp_path" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chunk_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "chunk_number" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "stored_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_retention_policies" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "retention_days" INTEGER,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_service_module_idx" ON "files"("service", "module");

-- CreateIndex
CREATE INDEX "files_owner_id_idx" ON "files"("owner_id");

-- CreateIndex
CREATE INDEX "files_reference_id_idx" ON "files"("reference_id");

-- CreateIndex
CREATE INDEX "files_checksum_idx" ON "files"("checksum");

-- CreateIndex
CREATE INDEX "files_status_idx" ON "files"("status");

-- CreateIndex
CREATE INDEX "files_status_retry_at_idx" ON "files"("status", "retry_at");

-- CreateIndex
CREATE INDEX "files_deleted_scheduled_delete_at_idx" ON "files"("deleted", "scheduled_delete_at");

-- CreateIndex
CREATE INDEX "files_version_of_idx" ON "files"("version_of");

-- CreateIndex
CREATE INDEX "chunk_uploads_status_idx" ON "chunk_uploads"("status");

-- CreateIndex
CREATE INDEX "chunk_uploads_expires_at_idx" ON "chunk_uploads"("expires_at");

-- CreateIndex
CREATE INDEX "chunks_upload_id_idx" ON "chunks"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "chunks_upload_id_chunk_number_key" ON "chunks"("upload_id", "chunk_number");

-- CreateIndex
CREATE UNIQUE INDEX "service_retention_policies_service_key" ON "service_retention_policies"("service");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_version_of_fkey" FOREIGN KEY ("version_of") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "chunk_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
