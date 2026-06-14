-- Order label/tracking fields for ShipStation v2 label buying.
ALTER TABLE "order"
  ADD COLUMN "shipping_service_code" TEXT,
  ADD COLUMN "shipping_carrier" TEXT,
  ADD COLUMN "label_url" TEXT,
  ADD COLUMN "label_cost_cents" INTEGER;
