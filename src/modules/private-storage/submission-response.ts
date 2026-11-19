import "server-only";
import { apiError } from "@/lib/api";
import { PrivatePhotoSubmissionError } from "./submissions";

export function privatePhotoSubmissionError(error: unknown) {
  if (error instanceof PrivatePhotoSubmissionError) {
    if (error.code === "PRIVATE_PHOTO_CONFLICT") return apiError("PRIVATE_PHOTO_CONFLICT", "This upload request was already used with different document or package details.", 409);
    if (error.code === "PRIVATE_PHOTO_ACCESS_CHANGED") return apiError("PRIVATE_PHOTO_ACCESS_CHANGED", "Your upload access changed. Reload and sign in again before retrying.", 403);
    if (error.code === "PRIVATE_PHOTO_ALREADY_VERIFIED") return apiError("IDENTITY_ALREADY_VERIFIED", "Your identity is already verified. Contact Support to change your document.", 409);
    if (error.code === "PRIVATE_PHOTO_REVIEW_REQUIRED") return apiError("PRIVATE_PHOTO_REVIEW_REQUIRED", "This upload needs a storage review. Keep the request reference and contact Support.", 409);
  }
  return apiError("PRIVATE_PHOTO_UNAVAILABLE", "The secure upload could not be confirmed. Check your submission history before retrying with the same request key.", 503);
}
