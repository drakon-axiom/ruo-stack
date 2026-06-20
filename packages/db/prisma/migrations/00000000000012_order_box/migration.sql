-- Lock the rules-engine package onto the order: the box + billable weight chosen
-- at rate-time, so the ShipStation export/label reflects exactly what was quoted.
ALTER TABLE "order"
  ADD COLUMN "box_id" UUID,
  ADD COLUMN "box_name" TEXT,
  ADD COLUMN "box_length_in" DOUBLE PRECISION,
  ADD COLUMN "box_width_in" DOUBLE PRECISION,
  ADD COLUMN "box_height_in" DOUBLE PRECISION,
  ADD COLUMN "billable_weight_oz" INTEGER;

-- A deleted box shouldn't delete orders — null the reference (dims/weight stay snapshotted).
ALTER TABLE "order" ADD CONSTRAINT "order_box_id_fkey"
  FOREIGN KEY ("box_id") REFERENCES "box"("id") ON DELETE SET NULL ON UPDATE CASCADE;
