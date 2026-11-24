export type InspectionUploadCapabilities = {
  photos: boolean;
  videos: boolean;
  maxPhotoBytes: number;
  maxVideoBytes: number;
  mode: "UNAVAILABLE" | "PRIVATE_PHOTOS" | "DEVELOPMENT";
};

/** Non-secret description only. Upload routes still enforce live authorization. */
export function inspectionUploadCapabilities(env: Record<string, string | undefined>, privatePhotosConfigured: boolean): InspectionUploadCapabilities {
  const privateRequested = env.PRIVATE_PHOTO_STORAGE_ENABLED === "true";
  const legacyDevelopment = !privateRequested && env.NODE_ENV !== "production" && env.ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS === "true";
  const photos = privateRequested ? privatePhotosConfigured : legacyDevelopment;
  return { photos, videos: legacyDevelopment, maxPhotoBytes: 8 * 1024 * 1024, maxVideoBytes: 30 * 1024 * 1024, mode: photos ? privateRequested ? "PRIVATE_PHOTOS" : "DEVELOPMENT" : "UNAVAILABLE" };
}
