import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.object({ decision: z.enum(["VERIFIED", "REJECTED"]), note: z.string().trim().min(5).max(1000), version: z.number().int().positive() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ verificationId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.COMPLIANCE) || session.portal !== "compliance") return apiError("COMPLIANCE_ACCESS_REQUIRED", "Verified Compliance access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Identity decisions must originate from the protected Compliance application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a decision and document the review reason.", 422, z.treeifyError(parsed.error));
  const { verificationId } = await context.params;
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.identityVerification.updateMany({ where: { id: verificationId, status: "PENDING", version: parsed.data.version }, data: { status: parsed.data.decision, reviewNote: parsed.data.note, reviewedAt: new Date(), reviewedById: session.userId, version: { increment: 1 } } });
    if (updated.count !== 1) return null;
    const verification = await tx.identityVerification.findUniqueOrThrow({ where: { id: verificationId }, select: { id: true, userId: true, documentType: true, status: true } });
    await tx.user.update({ where: { id: verification.userId }, data: { kycStatus: verification.status } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: `identity_verification.${parsed.data.decision.toLowerCase()}`, entityType: "IdentityVerification", entityId: verification.id, metadata: { customerId: verification.userId, documentType: verification.documentType } } });
    return verification;
  });
  if (!result) return apiError("IDENTITY_REVIEW_CONFLICT", "This submission is no longer pending or changed in another session. Refresh and try again.", 409);
  return apiSuccess({ verification: result }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
