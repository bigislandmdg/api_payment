-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- CreateTable
CREATE TABLE "partner_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_url" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "webhook_secret" TEXT,
    "fee_percentage" DOUBLE PRECISION NOT NULL,
    "fee_fixed" DOUBLE PRECISION NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_configs_name_key" ON "partner_configs"("name");

-- CreateIndex
CREATE INDEX "partner_configs_name_idx" ON "partner_configs"("name");

-- CreateIndex
CREATE INDEX "partner_configs_status_idx" ON "partner_configs"("status");
