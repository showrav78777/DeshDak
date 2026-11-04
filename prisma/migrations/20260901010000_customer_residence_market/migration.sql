ALTER TABLE "User"
ADD COLUMN "residenceCountryCode" VARCHAR(2) NOT NULL DEFAULT 'BD';

ALTER TABLE "User"
ADD CONSTRAINT "User_residenceCountryCode_format_check"
CHECK ("residenceCountryCode" ~ '^[A-Z]{2}$');

CREATE INDEX "User_residenceCountryCode_createdAt_idx"
ON "User"("residenceCountryCode", "createdAt");
