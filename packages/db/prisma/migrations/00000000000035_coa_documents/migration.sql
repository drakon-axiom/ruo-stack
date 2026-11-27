-- CreateTable
CREATE TABLE "coa_document" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coa_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coa_revision" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "upload_key" TEXT NOT NULL,
    "object_key" TEXT,
    "filename" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "lab" TEXT NOT NULL,
    "report_number" TEXT NOT NULL,
    "test_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "uploaded_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "withdrawal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coa_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coa_document_product_id_idx" ON "coa_document"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "coa_revision_public_id_key" ON "coa_revision"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "coa_revision_upload_key_key" ON "coa_revision"("upload_key");

-- CreateIndex
CREATE UNIQUE INDEX "coa_revision_object_key_key" ON "coa_revision"("object_key");

-- CreateIndex
CREATE INDEX "coa_revision_document_id_created_at_idx" ON "coa_revision"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "coa_revision_status_created_at_idx" ON "coa_revision"("status", "created_at");

-- AddForeignKey
ALTER TABLE "coa_document" ADD CONSTRAINT "coa_document_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coa_revision" ADD CONSTRAINT "coa_revision_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "coa_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE coa_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE coa_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coa_document, coa_revision FROM anon, authenticated;
ALTER TABLE coa_revision ADD CONSTRAINT coa_size CHECK(size_bytes > 0 AND size_bytes <= 10485760);
ALTER TABLE coa_revision ADD CONSTRAINT coa_status CHECK(status IN ('draft','awaiting_review','reviewed','rejected','published','withdrawn','abandoned'));
CREATE FUNCTION protect_coa_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'COA revisions are retained'; END IF;
 IF NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.upload_key IS DISTINCT FROM OLD.upload_key OR NEW.public_id IS DISTINCT FROM OLD.public_id THEN RAISE EXCEPTION 'COA identity is immutable'; END IF;
 IF OLD.object_key IS NOT NULL AND (NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR NEW.filename IS DISTINCT FROM OLD.filename OR NEW.lab IS DISTINCT FROM OLD.lab OR NEW.report_number IS DISTINCT FROM OLD.report_number OR NEW.test_date IS DISTINCT FROM OLD.test_date) THEN RAISE EXCEPTION 'Finalized COA content is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coa_revision_immutable BEFORE UPDATE OR DELETE ON coa_revision FOR EACH ROW EXECUTE FUNCTION protect_coa_revision();
REVOKE ALL ON FUNCTION protect_coa_revision() FROM PUBLIC;
