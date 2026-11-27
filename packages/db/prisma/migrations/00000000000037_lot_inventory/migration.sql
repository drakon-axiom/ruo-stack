-- AlterTable
ALTER TABLE "catalog_product" ADD COLUMN     "lot_tracking" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "traceability_reason" TEXT,
ADD COLUMN     "traceability_status" TEXT NOT NULL DEFAULT 'untracked';

-- AlterTable
ALTER TABLE "order_item" ADD COLUMN     "woo_line_id" TEXT;

-- CreateTable
CREATE TABLE "product_lot" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_code" TEXT NOT NULL,
    "coa_revision_id" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'quarantined',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_operation" (
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_operation_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "lot_movement" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "on_hand_delta" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL,
    "order_id" UUID,
    "actor_id" TEXT,
    "reason" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lot_allocation" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "coa_revision_id" UUID NOT NULL,
    "lot_code" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "woo_line_id" TEXT,
    "qty" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'reserved',
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_lot_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_lot_product_id_state_idx" ON "product_lot"("product_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "product_lot_product_id_lot_code_key" ON "product_lot"("product_id", "lot_code");

-- CreateIndex
CREATE INDEX "lot_movement_lot_id_created_at_idx" ON "lot_movement"("lot_id", "created_at");

-- CreateIndex
CREATE INDEX "order_lot_allocation_order_id_state_idx" ON "order_lot_allocation"("order_id", "state");

-- CreateIndex
CREATE INDEX "order_lot_allocation_lot_id_state_idx" ON "order_lot_allocation"("lot_id", "state");

-- AddForeignKey
ALTER TABLE "product_lot" ADD CONSTRAINT "product_lot_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lot" ADD CONSTRAINT "product_lot_coa_revision_id_fkey" FOREIGN KEY ("coa_revision_id") REFERENCES "coa_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_movement" ADD CONSTRAINT "lot_movement_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "product_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lot_allocation" ADD CONSTRAINT "order_lot_allocation_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lot_allocation" ADD CONSTRAINT "order_lot_allocation_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "product_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lot_allocation" ADD CONSTRAINT "order_lot_allocation_coa_revision_id_fkey" FOREIGN KEY ("coa_revision_id") REFERENCES "coa_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE product_lot ADD CONSTRAINT lot_balance CHECK(on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand);
ALTER TABLE product_lot ADD CONSTRAINT lot_state CHECK(state IN ('quarantined','released','recalled'));
ALTER TABLE order_lot_allocation ADD CONSTRAINT allocation_quantity CHECK(qty > 0);
ALTER TABLE order_lot_allocation ADD CONSTRAINT allocation_state CHECK(state IN ('reserved','released','shipped'));
ALTER TABLE product_lot ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lot_allocation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_lot, lot_operation, lot_movement, order_lot_allocation FROM anon, authenticated;
CREATE FUNCTION protect_lot_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME IN ('lot_movement','lot_operation') THEN RAISE EXCEPTION 'Inventory history is append only'; END IF;
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Lot records are retained'; END IF;
 IF TG_TABLE_NAME = 'product_lot' THEN
  IF NEW.product_id <> OLD.product_id OR NEW.lot_code <> OLD.lot_code OR NEW.coa_revision_id <> OLD.coa_revision_id THEN RAISE EXCEPTION 'Lot identity and certificate are immutable; record a correction'; END IF;
 ELSIF OLD.state = 'shipped' THEN RAISE EXCEPTION 'Shipped allocations are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lot_identity_immutable BEFORE UPDATE OR DELETE ON product_lot FOR EACH ROW EXECUTE FUNCTION protect_lot_history();
CREATE TRIGGER lot_movement_append_only BEFORE UPDATE OR DELETE ON lot_movement FOR EACH ROW EXECUTE FUNCTION protect_lot_history();
CREATE TRIGGER lot_operation_append_only BEFORE UPDATE OR DELETE ON lot_operation FOR EACH ROW EXECUTE FUNCTION protect_lot_history();
CREATE TRIGGER allocation_history_immutable BEFORE UPDATE OR DELETE ON order_lot_allocation FOR EACH ROW EXECUTE FUNCTION protect_lot_history();
REVOKE ALL ON FUNCTION protect_lot_history() FROM PUBLIC;
