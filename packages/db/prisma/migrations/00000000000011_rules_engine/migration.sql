-- Fulfillment rules engine (§6): admin-configurable box catalog + service mappings.

-- CreateEnum
CREATE TYPE "service_tier" AS ENUM ('economy', 'standard', 'expedited');

-- CreateEnum
CREATE TYPE "service_selection_policy" AS ENUM ('cheapest', 'fixed');

-- CreateTable
CREATE TABLE "box" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "inner_length_in" DOUBLE PRECISION NOT NULL,
    "inner_width_in" DOUBLE PRECISION NOT NULL,
    "inner_height_in" DOUBLE PRECISION NOT NULL,
    "max_weight_oz" INTEGER NOT NULL,
    "tare_oz" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "box_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_mapping" (
    "id" UUID NOT NULL,
    "tier" "service_tier" NOT NULL,
    "carrier_service_code" TEXT NOT NULL,
    "display_label" TEXT NOT NULL,
    "transit_estimate" TEXT NOT NULL,
    "max_weight_oz" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "selection_policy" "service_selection_policy" NOT NULL DEFAULT 'cheapest',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "box_enabled_idx" ON "box"("enabled");
CREATE UNIQUE INDEX "service_mapping_carrier_service_code_key" ON "service_mapping"("carrier_service_code");
CREATE INDEX "service_mapping_tier_idx" ON "service_mapping"("tier");

-- ── RLS: operator-owned (no brand access). Deny-by-default; API bypassrls role
-- reads/writes. FORCE so even the table owner is constrained. ──
ALTER TABLE "box" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "box" FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_mapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_mapping" FORCE ROW LEVEL SECURITY;

-- ── Seed defaults (admin can edit/extend; no code deploy to change a threshold) ──
INSERT INTO "box" ("id","name","inner_length_in","inner_width_in","inner_height_in","max_weight_oz","tare_oz","enabled","sort_order","updated_at") VALUES
  (gen_random_uuid(), 'Bubble Mailer', 9, 6, 1, 16, 1, true, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Small Box', 8, 6, 4, 80, 4, true, 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Medium Box', 12, 10, 6, 320, 8, true, 3, CURRENT_TIMESTAMP);

INSERT INTO "service_mapping" ("id","tier","carrier_service_code","display_label","transit_estimate","max_weight_oz","enabled","selection_policy","sort_order","updated_at") VALUES
  (gen_random_uuid(), 'economy',   'usps_ground_advantage', 'USPS Ground Advantage', '2–5 business days', 1120, true, 'cheapest', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'economy',   'ups_ground_saver',      'UPS Ground Saver',      '2–6 business days', 1120, true, 'cheapest', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'standard',  'ups_ground',            'UPS Ground',            '1–5 business days', 1120, true, 'cheapest', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expedited', 'ups_2nd_day_air',       'UPS 2nd Day Air',       '2 business days',   1120, true, 'cheapest', 4, CURRENT_TIMESTAMP);
