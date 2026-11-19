import "server-only";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { privatePhotoRuntime } from "./runtime";
import { createPrivatePhotoDelivery, PrivatePhotoDeliveryError } from "./photo-delivery";

/** A linked object never falls back to old ciphertext after a storage failure. */
export async function privatePhotoDeliveryResponse(input: { sessionId: string; kind: "identity" | "inspection"; subjectId: string }) {
  const target = input.kind === "identity" ? { identityVerificationId: input.subjectId } : { inspectionEvidenceId: input.subjectId };
  if (!await prisma.privatePhotoLink.findFirst({ where: target, select: { id: true } })) return null;
  const runtime = privatePhotoRuntime();
  if (!runtime) return apiError("PRIVATE_PHOTO_UNAVAILABLE", "Secure photo delivery is unavailable. Contact Support.", 503);
  try {
    const photo = await createPrivatePhotoDelivery(prisma, runtime.store).read(input);
    return new Response(new Uint8Array(photo.bytes), { headers: {
      "Content-Type": photo.mimeType, "Content-Length": String(photo.bytes.length),
      "Content-Disposition": "inline; filename=private-photo", "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    } });
  } catch (error) {
    if (error instanceof PrivatePhotoDeliveryError && error.message === "PRIVATE_PHOTO_ACCESS_DENIED") return apiError("PRIVATE_PHOTO_ACCESS_DENIED", "You do not have access to this photo.", 403);
    return apiError("PRIVATE_PHOTO_UNAVAILABLE", "This photo could not be opened securely. Contact Support.", 503);
  }
}
