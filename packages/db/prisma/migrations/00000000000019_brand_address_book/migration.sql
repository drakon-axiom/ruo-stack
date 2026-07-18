-- Address Book: saved ship-to (recipient) addresses per brand.
CREATE TABLE "brand_address" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_address_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brand_address_brand_id_idx" ON "brand_address"("brand_id");

ALTER TABLE "brand_address" ADD CONSTRAINT "brand_address_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
