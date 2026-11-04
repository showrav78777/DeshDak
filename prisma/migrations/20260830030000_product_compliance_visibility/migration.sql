CREATE TYPE "ProductComplianceStatus" AS ENUM ('CLEAR', 'BLOCKED', 'REVIEW_REQUIRED');

ALTER TABLE "Product"
ADD COLUMN "complianceStatus" "ProductComplianceStatus" NOT NULL DEFAULT 'CLEAR',
ADD COLUMN "complianceRuleCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "complianceScreenedAt" TIMESTAMP(3);

DROP INDEX "Product_categoryId_status_idx";
CREATE INDEX "Product_categoryId_status_complianceStatus_idx" ON "Product"("categoryId", "status", "complianceStatus");
