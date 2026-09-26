-- CreateEnum
CREATE TYPE "SleeveLength" AS ENUM ('SLEEVELESS', 'SHORT', 'THREE_QUARTER', 'LONG');

-- CreateEnum
CREATE TYPE "Neckline" AS ENUM ('CREW', 'SCOOP', 'V_NECK', 'COLLAR', 'BAND', 'HOOD');

-- CreateEnum
CREATE TYPE "GarmentLength" AS ENUM ('CROPPED', 'HIP', 'THIGH', 'KNEE', 'MIDI', 'ANKLE', 'FLOOR');

-- CreateEnum
CREATE TYPE "GarmentPattern" AS ENUM ('SOLID', 'STRIPED', 'CHECKED', 'FLORAL', 'DOTTED');

-- AlterTable
ALTER TABLE "product_sizing" ADD COLUMN     "color_option_id" UUID,
ADD COLUMN     "garment_length" "GarmentLength",
ADD COLUMN     "neckline" "Neckline",
ADD COLUMN     "pattern" "GarmentPattern",
ADD COLUMN     "sleeve_length" "SleeveLength";

-- CreateTable
CREATE TABLE "garment_swatches" (
    "id" UUID NOT NULL,
    "sizing_id" UUID NOT NULL,
    "option_value_id" UUID NOT NULL,
    "hex" VARCHAR(7) NOT NULL,

    CONSTRAINT "garment_swatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "garment_swatches_option_value_id_key" ON "garment_swatches"("option_value_id");

-- CreateIndex
CREATE INDEX "garment_swatches_sizing_id_idx" ON "garment_swatches"("sizing_id");

-- CreateIndex
CREATE INDEX "product_sizing_color_option_id_idx" ON "product_sizing"("color_option_id");

-- AddForeignKey
ALTER TABLE "product_sizing" ADD CONSTRAINT "product_sizing_color_option_id_fkey" FOREIGN KEY ("color_option_id") REFERENCES "product_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_swatches" ADD CONSTRAINT "garment_swatches_sizing_id_fkey" FOREIGN KEY ("sizing_id") REFERENCES "product_sizing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_swatches" ADD CONSTRAINT "garment_swatches_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A swatch is exactly `#rrggbb`: it is drawn as a colour on the avatar, so
-- no other text may reach that attribute, whichever path wrote it. The
-- sizing schema enforces the same; this is the last line.
ALTER TABLE "garment_swatches" ADD CONSTRAINT "garment_swatches_hex_format" CHECK ("hex" ~ '^#[0-9A-Fa-f]{6}$');
