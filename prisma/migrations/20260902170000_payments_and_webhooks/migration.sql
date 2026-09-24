-- P11 — payments and webhooks.
--
-- `payments` and `webhook_events` were created by P01 as empty boundary
-- tables and no code has ever written to either (verified: zero rows in
-- every environment, and `src/modules/payments` was an empty barrel until
-- this phase). That is why the status column can change type outright
-- instead of needing a create/backfill/swap dance — there is nothing to
-- back-fill. Everything else here is additive.
--
-- Wrapped in an explicit transaction: a migration that fails halfway and
-- leaves half an enum behind is worse than one that fails cleanly.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The generic hosted-checkout adapter joins the provider enum.
--    A plain ADD VALUE is safe here because nothing in this transaction
--    *uses* the new value — Postgres only refuses the read-after-add case.
-- ---------------------------------------------------------------------------
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'HOSTED_CHECKOUT' AFTER 'MANUAL';

-- ---------------------------------------------------------------------------
-- 2. One attempt's lifecycle, which is not the order's money state.
-- ---------------------------------------------------------------------------
CREATE TYPE "PaymentAttemptStatus" AS ENUM (
  'CREATED',
  'REQUIRES_ACTION',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
);

-- ---------------------------------------------------------------------------
-- 3. payments
-- ---------------------------------------------------------------------------
ALTER TABLE "payments" DROP COLUMN "status";
ALTER TABLE "payments" ADD COLUMN "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED';

-- The raw provider payload is deliberately not kept: it can carry a
-- cardholder name, a PAN echo or an auth token. A redacted, allowlisted
-- projection replaces it.
ALTER TABLE "payments" DROP COLUMN "raw_payload";
ALTER TABLE "payments" ADD COLUMN "provider_metadata" JSONB;

ALTER TABLE "payments" ADD COLUMN "idempotency_key" TEXT NOT NULL;
ALTER TABLE "payments" ADD COLUMN "checkout_url" TEXT;
ALTER TABLE "payments" ADD COLUMN "failure_code" TEXT;
ALTER TABLE "payments" ADD COLUMN "failure_message" TEXT;
ALTER TABLE "payments" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "last_event_at" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "failed_at" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "cancelled_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

DROP INDEX IF EXISTS "payments_order_id_idx";
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at");
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- The real "one live attempt per order" guarantee (P11 §8).
--
-- A partial unique index, which Prisma's schema language cannot express, so
-- it is written here and asserted by a test rather than assumed. Two
-- concurrent "start payment" requests for the same order both try to insert
-- a non-terminal row; exactly one wins, and the loser reads the winner's
-- attempt. An attempt that has reached a terminal state no longer occupies
-- the slot, which is what lets a customer retry after a decline.
CREATE UNIQUE INDEX "payments_one_live_attempt_per_order"
  ON "payments"("order_id")
  WHERE "status" IN ('CREATED', 'REQUIRES_ACTION', 'PENDING');

-- ---------------------------------------------------------------------------
-- 4. webhook_events
-- ---------------------------------------------------------------------------
ALTER TABLE "webhook_events" ADD COLUMN "event_type" TEXT;
ALTER TABLE "webhook_events" ADD COLUMN "signature_valid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "webhook_events" ADD COLUMN "payment_id" UUID;

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "webhook_events_payment_id_created_at_idx"
  ON "webhook_events"("payment_id", "created_at");

COMMIT;
