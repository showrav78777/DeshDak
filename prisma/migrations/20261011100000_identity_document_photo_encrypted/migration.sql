-- Private, encrypted KYC evidence. Existing historical submissions are retained without a photo.
ALTER TABLE "IdentityVerification"
  ADD COLUMN "documentPhotoCiphertext" TEXT,
  ADD COLUMN "documentPhotoIv" VARCHAR(32),
  ADD COLUMN "documentPhotoTag" VARCHAR(32),
  ADD COLUMN "documentPhotoMimeType" VARCHAR(64),
  ADD COLUMN "documentPhotoSizeBytes" INTEGER,
  ADD COLUMN "documentPhotoSha256" VARCHAR(64);
