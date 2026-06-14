-- Custom Store fulfillment: track when ShipStation first pulled an order via the
-- export endpoint. Powers the "Exported" indicator; cleared by the admin re-send
-- failsafe so the order re-appears in ShipStation's next export pull.
ALTER TABLE "order"
  ADD COLUMN "exported_at" TIMESTAMP(3);
