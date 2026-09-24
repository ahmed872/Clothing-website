-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('S3', 'LOCAL', 'EXTERNAL');

-- AlterTable
ALTER TABLE "media_assets"
  ADD COLUMN "provider" "StorageProvider" NOT NULL DEFAULT 'EXTERNAL',
  ADD COLUMN "content_hash" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_content_hash_key" ON "media_assets"("content_hash");
