-- AlterTable
ALTER TABLE "admin_user" ADD COLUMN     "mfa_enrollment_expires_at" TIMESTAMP(3),
ADD COLUMN     "mfa_enrollment_hash" TEXT,
ADD COLUMN     "mfa_pending_secret" TEXT;
