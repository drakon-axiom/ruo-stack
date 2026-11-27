-- CreateTable
CREATE TABLE "lot_allocation_amendment" (
    "id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "coa_revision_id" UUID NOT NULL,
    "lot_code" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_allocation_amendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lot_allocation_amendment_allocation_id_created_at_idx" ON "lot_allocation_amendment"("allocation_id", "created_at");

-- AddForeignKey
ALTER TABLE "lot_allocation_amendment" ADD CONSTRAINT "lot_allocation_amendment_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "order_lot_allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_allocation_amendment" ADD CONSTRAINT "lot_allocation_amendment_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "product_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_allocation_amendment" ADD CONSTRAINT "lot_allocation_amendment_coa_revision_id_fkey" FOREIGN KEY ("coa_revision_id") REFERENCES "coa_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE lot_allocation_amendment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lot_allocation_amendment FROM anon, authenticated;
CREATE OR REPLACE FUNCTION protect_lot_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME IN ('lot_movement','lot_operation','lot_allocation_amendment') THEN RAISE EXCEPTION 'Inventory history is append only'; END IF;
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Lot records are retained'; END IF;
 IF TG_TABLE_NAME = 'product_lot' THEN
  IF NEW.product_id <> OLD.product_id OR NEW.lot_code <> OLD.lot_code THEN RAISE EXCEPTION 'Lot identity is immutable'; END IF;
  IF NEW.coa_revision_id <> OLD.coa_revision_id AND (OLD.state <> 'quarantined' OR OLD.reserved <> 0) THEN RAISE EXCEPTION 'Quarantine and release reservations before changing current certificate'; END IF;
 ELSIF OLD.state = 'shipped' THEN RAISE EXCEPTION 'Shipped allocations are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER amendment_append_only BEFORE UPDATE OR DELETE ON lot_allocation_amendment FOR EACH ROW EXECUTE FUNCTION protect_lot_history();
