-- Clothing P05: optional AI try-on jobs. No body measurements, photos or
-- provider credentials are stored; see the TryOnJob model's comment.

-- CreateEnum
CREATE TYPE "TryOnJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "try_on_jobs" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_job_id" VARCHAR(128),
    "status" "TryOnJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64),
    "result_url" VARCHAR(2048),
    "last_event_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),
    "consented_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "try_on_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "try_on_jobs_customer_id_created_at_idx" ON "try_on_jobs"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "try_on_jobs_product_id_idx" ON "try_on_jobs"("product_id");

-- CreateIndex
CREATE INDEX "try_on_jobs_variant_id_idx" ON "try_on_jobs"("variant_id");

-- CreateIndex
CREATE INDEX "try_on_jobs_status_expires_at_idx" ON "try_on_jobs"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "try_on_jobs_customer_id_idempotency_key_key" ON "try_on_jobs"("customer_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "try_on_jobs_provider_provider_job_id_key" ON "try_on_jobs"("provider", "provider_job_id");

-- AddForeignKey
ALTER TABLE "try_on_jobs" ADD CONSTRAINT "try_on_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "try_on_jobs" ADD CONSTRAINT "try_on_jobs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "try_on_jobs" ADD CONSTRAINT "try_on_jobs_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Defence in depth for what the service already enforces: attempts are
-- counted up from zero, the request hash is a sha256 hex digest, and a
-- stored result URL is HTTPS (the host allowlist is applied before this).
ALTER TABLE "try_on_jobs" ADD CONSTRAINT "try_on_jobs_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "try_on_jobs" ADD CONSTRAINT "try_on_jobs_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "try_on_jobs" ADD CONSTRAINT "try_on_jobs_result_url_check" CHECK ("result_url" IS NULL OR "result_url" LIKE 'https://%');
