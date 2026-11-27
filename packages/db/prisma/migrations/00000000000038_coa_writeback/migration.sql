-- CreateTable
CREATE TABLE "coa_writeback_job" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "coa_writeback_job_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "coa_writeback_job_status_next_attempt_at_idx" ON "coa_writeback_job"("status", "next_attempt_at");

ALTER TABLE coa_writeback_job ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coa_writeback_job FROM anon, authenticated;
ALTER TABLE coa_writeback_job ADD CONSTRAINT writeback_kind CHECK(kind IN ('shipment','product'));
ALTER TABLE coa_writeback_job ADD CONSTRAINT writeback_status CHECK(status IN ('pending','failed','complete'));
