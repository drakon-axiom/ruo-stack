-- Branding: per-brand theme colors (logo already lives in brand.logo_url).
-- Stored as hex strings (#RRGGBB); nullable until the brand sets them.
ALTER TABLE "brand" ADD COLUMN "primary_color" TEXT;
ALTER TABLE "brand" ADD COLUMN "accent_color" TEXT;
