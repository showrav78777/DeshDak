CREATE TYPE "AdvertisementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');
CREATE TYPE "AdvertisementPlacement" AS ENUM ('GLOBAL_BANNER', 'ENTRY_POPUP', 'HOME_FEED', 'PRODUCT_LIST', 'PRODUCT_DETAIL', 'CART', 'REELS');

CREATE TABLE "Advertisement" (
    "id" TEXT NOT NULL,
    "adCode" TEXT NOT NULL,
    "advertiserName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "imageUrl" TEXT,
    "targetUrl" TEXT NOT NULL,
    "altText" TEXT,
    "placement" "AdvertisementPlacement" NOT NULL,
    "pagePath" TEXT,
    "status" "AdvertisementStatus" NOT NULL DEFAULT 'DRAFT',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isDismissible" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Advertisement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Advertisement_adCode_key" ON "Advertisement"("adCode");
CREATE INDEX "Advertisement_status_placement_startsAt_endsAt_idx" ON "Advertisement"("status", "placement", "startsAt", "endsAt");
CREATE INDEX "Advertisement_pagePath_status_idx" ON "Advertisement"("pagePath", "status");
CREATE INDEX "Advertisement_createdById_createdAt_idx" ON "Advertisement"("createdById", "createdAt");

ALTER TABLE "Advertisement" ADD CONSTRAINT "Advertisement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
