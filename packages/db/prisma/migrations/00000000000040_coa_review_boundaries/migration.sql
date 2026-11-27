-- AlterTable
ALTER TABLE "order" ADD COLUMN     "origin_store_id" UUID,
ADD COLUMN     "origin_store_url" TEXT;

-- AlterTable
ALTER TABLE "coa_revision" ADD COLUMN     "cleanup_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_cleanup_at" TIMESTAMP(3),
ADD COLUMN     "upload_cleaned_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "order_traceability_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "order_traceability_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_traceability_item_product_id_idx" ON "order_traceability_item"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_traceability_item_order_id_order_item_id_key" ON "order_traceability_item"("order_id", "order_item_id");

-- AddForeignKey
ALTER TABLE "order_traceability_item" ADD CONSTRAINT "order_traceability_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE order_traceability_item ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_traceability_item FROM anon, authenticated;
ALTER TABLE order_traceability_item ADD CONSTRAINT traceability_qty CHECK(qty>0);
