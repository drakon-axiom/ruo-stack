-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('none', 'pro');

-- CreateEnum
CREATE TYPE "brand_member_role" AS ENUM ('owner', 'staff');

-- CreateEnum
CREATE TYPE "brand_member_status" AS ENUM ('active', 'invited', 'suspended');

-- CreateEnum
CREATE TYPE "brand_realm" AS ENUM ('brand');

-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('super_admin', 'operations', 'support', 'finance');

-- CreateEnum
CREATE TYPE "admin_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('admin', 'brand', 'system');

-- CreateEnum
CREATE TYPE "catalog_status" AS ENUM ('in_stock', 'soon', 'out_of_stock');

-- CreateEnum
CREATE TYPE "webhook_source" AS ENUM ('stripe');

-- CreateEnum
CREATE TYPE "webhook_status" AS ENUM ('received', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "tax_exemption_status" AS ENUM ('none', 'on_file', 'expired');

-- CreateTable
CREATE TABLE "user_profile" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "name_last_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand" (
    "id" UUID NOT NULL,
    "brand_name" TEXT NOT NULL,
    "logo_url" TEXT,
    "website" TEXT,
    "sales_channel" TEXT,
    "subscription_status" "subscription_status" NOT NULL DEFAULT 'none',
    "stripe_customer_id" TEXT,
    "member_since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referral_code" TEXT NOT NULL,
    "referred_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_member" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "brand_member_role" NOT NULL,
    "status" "brand_member_status" NOT NULL DEFAULT 'active',
    "invited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_user_role" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "realm" "brand_realm" NOT NULL DEFAULT 'brand',
    "brand_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "admin_role" NOT NULL,
    "status" "admin_status" NOT NULL DEFAULT 'active',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_session" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_password_reset_token" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_product" (
    "id" UUID NOT NULL,
    "canonical_sku" TEXT NOT NULL,
    "compound" TEXT NOT NULL,
    "dose" TEXT,
    "unit" TEXT,
    "name" TEXT NOT NULL,
    "description_template" TEXT,
    "wholesale_cost" INTEGER NOT NULL,
    "suggested_retail" INTEGER NOT NULL,
    "status" "catalog_status" NOT NULL DEFAULT 'soon',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "weight" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "packaging_rule" TEXT,
    "coa_id" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" UUID NOT NULL,
    "source" "webhook_source" NOT NULL,
    "external_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "webhook_status" NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_tax_exemption" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "certificate_ref" TEXT,
    "expires_at" TIMESTAMP(3),
    "status" "tax_exemption_status" NOT NULL DEFAULT 'none',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_tax_exemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_referral_code_key" ON "brand"("referral_code");

-- CreateIndex
CREATE INDEX "brand_member_user_id_idx" ON "brand_member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_member_brand_id_user_id_key" ON "brand_member"("brand_id", "user_id");

-- CreateIndex
CREATE INDEX "brand_user_role_user_id_idx" ON "brand_user_role"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_user_role_user_id_brand_id_key" ON "brand_user_role"("user_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_email_key" ON "admin_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_session_refresh_token_hash_key" ON "admin_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "admin_session_admin_user_id_idx" ON "admin_session"("admin_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_password_reset_token_token_hash_key" ON "admin_password_reset_token"("token_hash");

-- CreateIndex
CREATE INDEX "audit_log_actor_type_created_at_idx" ON "audit_log"("actor_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_product_canonical_sku_key" ON "catalog_product"("canonical_sku");

-- CreateIndex
CREATE INDEX "catalog_product_status_idx" ON "catalog_product"("status");

-- CreateIndex
CREATE INDEX "catalog_product_is_published_idx" ON "catalog_product"("is_published");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_source_external_id_key" ON "webhook_event"("source", "external_id");

-- CreateIndex
CREATE INDEX "brand_tax_exemption_brand_id_idx" ON "brand_tax_exemption"("brand_id");

-- AddForeignKey
ALTER TABLE "brand_member" ADD CONSTRAINT "brand_member_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_user_role" ADD CONSTRAINT "brand_user_role_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_password_reset_token" ADD CONSTRAINT "admin_password_reset_token_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_tax_exemption" ADD CONSTRAINT "brand_tax_exemption_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

