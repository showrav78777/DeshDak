import { authorizePrivateUpload } from "@/modules/private-storage/upload-authorization";
import { MultipartUploadError, readBoundedMultipart } from "@/lib/uploads/bounded-multipart";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { consumeSecurityRateLimit, requestIp } from "@/modules/auth/rate-limit";
import { encryptUploadedIdentityDocument, identityDocumentUploadsEnabled } from "@/modules/compliance/identity-document";

const schema = z.object({
  documentType: z.enum(["NATIONAL_ID", "PASSPORT", "DRIVING_LICENSE"]),
  issuingCountryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  documentNumberLast4: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}$/),
});

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const [user, submissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId }, select: { phone: true, phoneVerifiedAt: true, kycStatus: true } }),
    prisma.identityVerification.findMany({ where: { userId: session.userId }, select: { id: true, documentType: true, issuingCountryCode: true, documentNumberLast4: true, status: true, submittedAt: true, reviewedAt: true, reviewNote: true }, orderBy: { submittedAt: "desc" }, take: 10 }),
  ]);
  return apiSuccess({ verification: user, submissions }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Identity verification must be submitted from the protected customer application.", 403);
  if (!identityDocumentUploadsEnabled()) return apiError("IDENTITY_DOCUMENT_UPLOAD_UNAVAILABLE", "Secure document-photo upload is unavailable until the approved private storage and malware scanning service is configured.", 503);
  const [accountLimit, ipLimit] = await Promise.all([
    consumeSecurityRateLimit("identity-document:account", session.userId, 3, 24 * 60 * 60_000),
    consumeSecurityRateLimit("identity-document:ip", requestIp(request), 10, 60 * 60_000),
  ]);
  if (!accountLimit.allowed || !ipLimit.allowed) {
    const response = apiError("TOO_MANY_REQUESTS", "Too many identity-document submissions. Please wait before submitting again.", 429);
    response.headers.set("Retry-After", String(Math.max(accountLimit.retryAfterSeconds, ipLimit.retryAfterSeconds)));
    return response;
  }
  let formData: FormData;
  try { formData = await readBoundedMultipart(request, 5 * 1024 * 1024 + 128 * 1024); }
  catch (error) {
    if (error instanceof MultipartUploadError) return apiError(error.status === 413 ? "DOCUMENT_PHOTO_TOO_LARGE" : "INVALID_UPLOAD_REQUEST", error.message, error.status);
    return apiError("INVALID_UPLOAD_REQUEST", "Upload form could not be read.", 422);
  }
  const parsed = schema.safeParse({ documentType: formData?.get("documentType"), issuingCountryCode: formData?.get("issuingCountryCode"), documentNumberLast4: formData?.get("documentNumberLast4") });
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a document type, issuing country, and the final four characters only.", 422, z.treeifyError(parsed.error));
  const documentPhoto = formData?.get("documentPhoto");
  if (!(documentPhoto instanceof File) || formData.getAll("documentPhoto").length !== 1) return apiError("DOCUMENT_PHOTO_REQUIRED", "Upload one clear document photo before submitting verification.", 422);
  let encryptedPhoto;
  try { encryptedPhoto = await encryptUploadedIdentityDocument(documentPhoto); }
  catch (error) { return apiError("INVALID_DOCUMENT_PHOTO", error instanceof Error ? error.message : "Unable to process this document photo.", 422); }
  const submission = await prisma.$transaction(async (tx) => {
    if (!await authorizePrivateUpload(tx, { userId: session.userId, sessionId: session.sessionId, kind: "identity" })) return "ACCESS_CHANGED" as const;
    const current = await tx.user.findUnique({ where: { id: session.userId }, select: { kycStatus: true } });
    if (!current) return null;
    if (current.kycStatus === "VERIFIED") return "VERIFIED" as const;
    await tx.identityVerification.updateMany({ where: { userId: session.userId, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: new Date(), reviewNote: "Superseded by a newer customer submission." } });
    const created = await tx.identityVerification.create({ data: { userId: session.userId, ...parsed.data, ...encryptedPhoto, status: "PENDING" }, select: { id: true, documentType: true, issuingCountryCode: true, documentNumberLast4: true, status: true, submittedAt: true, documentPhotoMimeType: true, documentPhotoSizeBytes: true } });
    await tx.user.update({ where: { id: session.userId }, data: { kycStatus: "PENDING" } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "identity_verification.submitted", entityType: "IdentityVerification", entityId: created.id, metadata: { documentType: created.documentType, issuingCountryCode: created.issuingCountryCode, documentNumberLast4: created.documentNumberLast4, photoReceived: true, photoMimeType: created.documentPhotoMimeType, photoBytes: created.documentPhotoSizeBytes } } });
    return created;
  });
  if (submission === "ACCESS_CHANGED") return apiError("CUSTOMER_ACCESS_REQUIRED", "Your account access changed during upload. Sign in again before submitting a document.", 403);
  if (!submission) return apiError("ACCOUNT_NOT_FOUND", "Your customer account was not found.", 404);
  if (submission === "VERIFIED") return apiError("IDENTITY_ALREADY_VERIFIED", "Your identity is already verified. Contact support if your document details need to change.", 409);
  return apiSuccess({ submission }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
