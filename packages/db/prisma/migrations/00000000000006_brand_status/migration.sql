-- Brand suspension (operator Brand Manager). Suspended brands are blocked from
-- /api/brand/* at the guard.
CREATE TYPE "brand_status" AS ENUM ('active', 'suspended');
ALTER TABLE "brand" ADD COLUMN "status" "brand_status" NOT NULL DEFAULT 'active';
