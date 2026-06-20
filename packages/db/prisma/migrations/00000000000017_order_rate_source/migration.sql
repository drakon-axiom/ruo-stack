-- Reporting: record how each order's shipping was priced (flat / fallback /
-- shipstation / computed / quote) so the fallback rate is exact.
ALTER TABLE "order" ADD COLUMN "rate_source" TEXT;
