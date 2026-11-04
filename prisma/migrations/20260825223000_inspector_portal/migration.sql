ALTER TYPE "PackageEventType" ADD VALUE 'INSPECTED';

ALTER TABLE "Inspection" ADD COLUMN "mediaRefs" JSONB;

ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Inspection_inspectorId_createdAt_idx" ON "Inspection"("inspectorId", "createdAt");
