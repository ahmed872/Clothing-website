-- CreateEnum
CREATE TYPE "FitPreference" AS ENUM ('SLIM', 'REGULAR', 'RELAXED');

-- CreateEnum
CREATE TYPE "GarmentType" AS ENUM ('T_SHIRT', 'SHIRT', 'HOODIE', 'SWEATER', 'JACKET', 'CARDIGAN', 'DRESS', 'ABAYA', 'THOBE', 'JEANS', 'TROUSERS', 'SHORTS', 'SKIRT');

-- AlterTable
ALTER TABLE "body_profiles" ADD COLUMN     "fit_preference" "FitPreference" NOT NULL DEFAULT 'REGULAR';

-- CreateTable
CREATE TABLE "product_sizing" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "garment_type" "GarmentType" NOT NULL,
    "size_option_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_sizing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_chart_entries" (
    "id" UUID NOT NULL,
    "sizing_id" UUID NOT NULL,
    "option_value_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "chest_cm" DECIMAL(4,1),
    "waist_cm" DECIMAL(4,1),
    "hip_cm" DECIMAL(4,1),
    "shoulder_cm" DECIMAL(4,1),
    "sleeve_cm" DECIMAL(4,1),
    "inseam_cm" DECIMAL(4,1),
    "length_cm" DECIMAL(4,1),
    "neck_cm" DECIMAL(4,1),

    CONSTRAINT "size_chart_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_sizing_product_id_key" ON "product_sizing"("product_id");

-- CreateIndex
CREATE INDEX "product_sizing_size_option_id_idx" ON "product_sizing"("size_option_id");

-- CreateIndex
CREATE UNIQUE INDEX "size_chart_entries_option_value_id_key" ON "size_chart_entries"("option_value_id");

-- CreateIndex
CREATE INDEX "size_chart_entries_sizing_id_position_idx" ON "size_chart_entries"("sizing_id", "position");

-- AddForeignKey
ALTER TABLE "product_sizing" ADD CONSTRAINT "product_sizing_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sizing" ADD CONSTRAINT "product_sizing_size_option_id_fkey" FOREIGN KEY ("size_option_id") REFERENCES "product_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "size_chart_entries" ADD CONSTRAINT "size_chart_entries_sizing_id_fkey" FOREIGN KEY ("sizing_id") REFERENCES "product_sizing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "size_chart_entries" ADD CONSTRAINT "size_chart_entries_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Last-line data checks. The realistic per-measurement ranges live in the
-- size chart schema (src/modules/sizing/size-chart.schemas.ts), where they
-- can be explained and localised; this only guarantees that no write path,
-- including one that skips the service, stores a zero or negative garment
-- measurement or a negative position. Prisma does not model CHECK
-- constraints, so they live here only.
ALTER TABLE "size_chart_entries" ADD CONSTRAINT "size_chart_entries_values_positive" CHECK (
  "position" >= 0
  AND ("chest_cm" IS NULL OR "chest_cm" > 0)
  AND ("waist_cm" IS NULL OR "waist_cm" > 0)
  AND ("hip_cm" IS NULL OR "hip_cm" > 0)
  AND ("shoulder_cm" IS NULL OR "shoulder_cm" > 0)
  AND ("sleeve_cm" IS NULL OR "sleeve_cm" > 0)
  AND ("inseam_cm" IS NULL OR "inseam_cm" > 0)
  AND ("length_cm" IS NULL OR "length_cm" > 0)
  AND ("neck_cm" IS NULL OR "neck_cm" > 0)
);
