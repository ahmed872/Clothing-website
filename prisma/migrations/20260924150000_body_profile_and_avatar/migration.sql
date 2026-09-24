-- Clothing P01: the customer's body profile and avatar configuration.

-- CreateEnum
CREATE TYPE "BodyProfileGender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "BodyShape" AS ENUM ('STRAIGHT', 'DEFINED_WAIST', 'HIPS_WIDER', 'CHEST_WIDER', 'WAIST_WIDEST');

-- CreateEnum
CREATE TYPE "SkinTone" AS ENUM ('LIGHT', 'MEDIUM_LIGHT', 'MEDIUM', 'MEDIUM_DARK', 'DARK');

-- CreateEnum
CREATE TYPE "HairStyle" AS ENUM ('SHORT', 'MEDIUM', 'LONG', 'CURLY', 'STRAIGHT', 'WAVY', 'BUZZ', 'COVERED');

-- CreateEnum
CREATE TYPE "HairColor" AS ENUM ('BLACK', 'DARK_BROWN', 'BROWN', 'LIGHT_BROWN', 'BLONDE', 'RED', 'GRAY', 'WHITE');

-- CreateEnum
CREATE TYPE "FacialHair" AS ENUM ('NONE', 'SHORT_BEARD', 'LONG_BEARD', 'MUSTACHE');

-- CreateEnum
CREATE TYPE "GlassesStyle" AS ENUM ('ROUND', 'RECTANGULAR', 'AVIATOR', 'CAT_EYE');

-- CreateEnum
CREATE TYPE "GlassesFrameColor" AS ENUM ('BLACK', 'BROWN', 'GOLD', 'SILVER', 'CLEAR');

-- CreateTable
CREATE TABLE "body_profiles" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "gender" "BodyProfileGender" NOT NULL,
    "height_cm" DECIMAL(4,1) NOT NULL,
    "weight_kg" DECIMAL(4,1) NOT NULL,
    "waist_cm" DECIMAL(4,1) NOT NULL,
    "chest_cm" DECIMAL(4,1),
    "hip_cm" DECIMAL(4,1),
    "shoulder_cm" DECIMAL(4,1),
    "inseam_cm" DECIMAL(4,1),
    "sleeve_length_cm" DECIMAL(4,1),
    "neck_cm" DECIMAL(4,1),
    "body_shape" "BodyShape",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "body_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatar_configurations" (
    "id" UUID NOT NULL,
    "body_profile_id" UUID NOT NULL,
    "skin_tone" "SkinTone",
    "hair_style" "HairStyle",
    "hair_color" "HairColor",
    "facial_hair" "FacialHair",
    "wears_glasses" BOOLEAN NOT NULL DEFAULT false,
    "glasses_style" "GlassesStyle",
    "glasses_frame_color" "GlassesFrameColor",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "body_profiles_customer_id_key" ON "body_profiles"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_configurations_body_profile_id_key" ON "avatar_configurations"("body_profile_id");

-- AddForeignKey
ALTER TABLE "body_profiles" ADD CONSTRAINT "body_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatar_configurations" ADD CONSTRAINT "avatar_configurations_body_profile_id_fkey" FOREIGN KEY ("body_profile_id") REFERENCES "body_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Last-line data checks. The realistic human ranges live in
-- `bodyProfileInputSchema` (src/modules/body-profile/schemas.ts), where they
-- can be explained and localised; these only guarantee that no write path,
-- including one that skips the service, can store a zero or negative
-- measurement, or glasses details for someone who does not wear glasses.
-- Prisma does not model CHECK constraints, so they live here only.
ALTER TABLE "body_profiles" ADD CONSTRAINT "body_profiles_measurements_positive" CHECK (
  "height_cm" > 0
  AND "weight_kg" > 0
  AND "waist_cm" > 0
  AND ("chest_cm" IS NULL OR "chest_cm" > 0)
  AND ("hip_cm" IS NULL OR "hip_cm" > 0)
  AND ("shoulder_cm" IS NULL OR "shoulder_cm" > 0)
  AND ("inseam_cm" IS NULL OR "inseam_cm" > 0)
  AND ("sleeve_length_cm" IS NULL OR "sleeve_length_cm" > 0)
  AND ("neck_cm" IS NULL OR "neck_cm" > 0)
);

ALTER TABLE "avatar_configurations" ADD CONSTRAINT "avatar_configurations_glasses_consistent" CHECK (
  "wears_glasses" OR ("glasses_style" IS NULL AND "glasses_frame_color" IS NULL)
);
