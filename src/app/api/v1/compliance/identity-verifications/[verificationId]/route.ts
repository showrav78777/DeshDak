import { reviewIdentityVerification } from "@/modules/compliance/identity-review";
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
  const result = await reviewIdentityVerification(prisma, { userId: session.userId, sessionId: session.sessionId, verificationId, ...parsed.data });
  if (result.outcome === "denied") return apiError("COMPLIANCE_ACCESS_REQUIRED", "Your review access changed. Sign in again before reviewing this submission.", 403);
  if (result.outcome === "conflict") return apiError("IDENTITY_REVIEW_CONFLICT", "This submission is no longer pending or changed in another session. Refresh and try again.", 409);
  return apiSuccess({ verification: result.verification }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
