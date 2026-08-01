-- Announcements (architecture §1.1 entity, §1.3 admin screen) + the per-user read
-- receipts behind the brand Notifications inbox.
--
-- No fan-out table: the inbox is DERIVED at read time from (audience, status,
-- publish_at, expires_at), so publishing writes one row, new brands see history
-- automatically, and there is no scheduler to run. `announcement_read` records
-- only the reads that actually happen — absence of a row means unread.

-- CreateEnum
CREATE TYPE "announcement_audience" AS ENUM ('all_brands', 'segment', 'single_brand');
CREATE TYPE "announcement_type" AS ENUM ('announcement', 'restock', 'maintenance');
CREATE TYPE "announcement_status" AS ENUM ('draft', 'published', 'archived');

-- CreateTable
CREATE TABLE "announcement" (
    "id" UUID NOT NULL,
    "audience" "announcement_audience" NOT NULL DEFAULT 'all_brands',
    "brand_id" UUID,
    "type" "announcement_type" NOT NULL DEFAULT 'announcement',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publish_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "status" "announcement_status" NOT NULL DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "announcement_read" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_read_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcement_status_idx" ON "announcement"("status");
CREATE INDEX "announcement_brand_id_idx" ON "announcement"("brand_id");
CREATE UNIQUE INDEX "announcement_read_announcement_id_user_id_key" ON "announcement_read"("announcement_id", "user_id");
CREATE INDEX "announcement_read_user_id_idx" ON "announcement_read"("user_id");

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_read" ADD CONSTRAINT "announcement_read_announcement_id_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A single_brand broadcast must name its brand; a platform-wide one must not.
-- Enforced in the DB as well as the API so a bad row can't be written at all.
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_audience_brand_ck"
  CHECK (
    (audience = 'single_brand' AND brand_id IS NOT NULL)
    OR (audience <> 'single_brand' AND brand_id IS NULL)
  );

-- ── RLS: deny-by-default + force, per the platform invariant. ────────────────
-- The API (bypassrls `prisma` role) is the real enforcement point; these are the
-- defense-in-depth layer. Note the announcement policy encodes the SAME
-- visibility rule as `isAnnouncementVisible` in @ruostack/shared — a direct
-- client path can never see a draft, a future-dated, or an expired broadcast,
-- nor another brand's single_brand message.
ALTER TABLE "announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "announcement_read" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcement_read" FORCE ROW LEVEL SECURITY;

CREATE POLICY "announcement_tenant_select" ON "announcement"
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND (publish_at IS NULL OR publish_at <= now())
    AND (expires_at IS NULL OR expires_at > now())
    AND (audience = 'all_brands' OR brand_id IN (SELECT public.current_user_brand_ids()))
  );

CREATE POLICY "announcement_read_own_select" ON "announcement_read"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
