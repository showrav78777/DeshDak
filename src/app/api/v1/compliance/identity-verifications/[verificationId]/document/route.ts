import { authorizeLegacyPhotoRead } from "@/modules/private-storage/legacy-read-authorization";
import { blockQuarantinedPrivateRecord } from "@/modules/private-storage/quarantine";
import { type NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { decryptIdentityDocument } from "@/modules/compliance/identity-document";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ verificationId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.COMPLIANCE) || session.portal !== "compliance") return apiError("COMPLIANCE_ACCESS_REQUIRED", "Verified Compliance access is required.", 403);
  const { verificationId } = await context.params;
  const verification = await prisma.identityVerification.findUnique({ where: { id: verificationId }, select: { id: true, documentPhotoCiphertext: true, documentPhotoIv: true, documentPhotoTag: true, documentPhotoMimeType: true, documentPhotoSha256: true } });
  if (!verification?.documentPhotoCiphertext || !verification.documentPhotoIv || !verification.documentPhotoTag || !verification.documentPhotoMimeType) return apiError("DOCUMENT_PHOTO_NOT_AVAILABLE", "No securely uploaded document photo is available for this case.", 404);
  if (await blockQuarantinedPrivateRecord(prisma, "identity", verificationId, session.userId)) return apiError("PHOTO_QUARANTINED", "This photo is blocked pending a controlled security review.", 410);
  try {
    const photo = decryptIdentityDocument({ documentPhotoCiphertext: verification.documentPhotoCiphertext, documentPhotoIv: verification.documentPhotoIv, documentPhotoTag: verification.documentPhotoTag });
    if (await blockQuarantinedPrivateRecord(prisma, "identity", verificationId, session.userId)) return apiError("PHOTO_QUARANTINED", "This photo is blocked pending a controlled security review.", 410);
    if (!await authorizeLegacyPhotoRead(prisma, { userId: session.userId, sessionId: session.sessionId, kind: "identity", subjectId: verificationId, sha256: verification.documentPhotoSha256 })) return apiError("COMPLIANCE_ACCESS_REQUIRED", "Your access changed. Sign in again before viewing this document.", 403);
    return new Response(photo, { headers: { "Content-Type": verification.documentPhotoMimeType, "Content-Disposition": "inline; filename=identity-document", "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch {
    return apiError("DOCUMENT_PHOTO_UNAVAILABLE", "The document photo could not be opened securely. Contact a platform administrator.", 500);
  }
}
