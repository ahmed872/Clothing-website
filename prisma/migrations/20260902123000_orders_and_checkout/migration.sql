-- P10: orders and checkout.
--
-- Three separate state machines replace the single OrderStatus column: the
-- lifecycle (OrderStatus), the money (PaymentStatus) and the shipment
-- (FulfillmentStatus). An order that is paid, cancelled and refunded has to
-- say all three at once, which one column cannot do.
--
-- Both enum rewrites use the create-new/swap/drop-old form rather than
-- `ALTER TYPE ... ADD VALUE`: PostgreSQL refuses to use a newly added enum
-- value inside the same transaction that added it, and this migration sets a
-- column default to one of the new values. The orders, order_items,
-- order_events and payments tables are empty, so no row is rewritten.

-- Wrapped explicitly: this file mixes enum rewrites with column changes that
-- depend on them, and a half-applied migration would leave the database with
-- an OrderStatus_old nobody can drop. PostgreSQL has transactional DDL, so
-- either all of this lands or none of it does.
BEGIN;

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('UNFULFILLED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('CREATED', 'ORDER_STATUS', 'PAYMENT_STATUS', 'FULFILLMENT_STATUS', 'NOTE');

-- order_events must stop referencing the old OrderStatus before that type
-- can be dropped below; PostgreSQL refuses to drop a type any column still
-- depends on.
-- AlterTable
ALTER TABLE "order_events" DROP COLUMN "from_status",
DROP COLUMN "to_status",
ADD COLUMN     "from_value" TEXT,
ADD COLUMN     "to_value" TEXT,
ADD COLUMN     "type" "OrderEventType" NOT NULL;

-- AlterEnum: OrderStatus loses SHIPPED/DELIVERED (now fulfillment) and
-- REFUNDED (now payment), and gains COMPLETED.
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING_PAYMENT', 'PENDING_MANUAL_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED');
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";

-- AlterEnum: PaymentStatus gains UNPAID as the resting state.
CREATE TYPE "PaymentStatus_new" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payments" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "access_token_hash" TEXT,
ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "coupon_code" TEXT,
ADD COLUMN     "fulfillment_status" "FulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "inventory_restored_at" TIMESTAMP(3),
ADD COLUMN     "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID';

-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "product_name_snapshot",
DROP COLUMN "variant_label_snapshot",
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'SAR',
ADD COLUMN     "line_discount_minor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "line_subtotal_minor" INTEGER NOT NULL,
ADD COLUMN     "options_snapshot" JSONB,
ADD COLUMN     "product_id" UUID,
ADD COLUMN     "product_name_ar_snapshot" TEXT NOT NULL,
ADD COLUMN     "product_name_en_snapshot" TEXT NOT NULL,
ADD COLUMN     "variant_label_ar_snapshot" TEXT,
ADD COLUMN     "variant_label_en_snapshot" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_access_token_hash_key" ON "orders"("access_token_hash");
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");
CREATE INDEX "orders_fulfillment_status_idx" ON "orders"("fulfillment_status");
CREATE INDEX "orders_placed_at_idx" ON "orders"("placed_at");
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

COMMIT;
