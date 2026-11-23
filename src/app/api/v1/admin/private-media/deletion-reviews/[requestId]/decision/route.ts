import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createMediaLifecycle, mediaDeletionDecision } from "@/modules/private-storage/lifecycle";
import { privateMediaHeaders, privateMediaHttpAccess, privateMediaHttpError } from "@/modules/private-storage/lifecycle-http";
export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  const access = await privateMediaHttpAccess(request, true);
  if (access.error) return access.error;
  const { requestId } = await context.params;
  const body = mediaDeletionDecision.safeParse(access.body);
  if (!z.uuid().safeParse(requestId).success || !body.success) return apiError("VALIDATION_ERROR", "Choose a valid request and complete the independent decision.", 422);
  try { return apiSuccess(await createMediaLifecycle(prisma).decideDeletionReview(access.session!.sessionId, requestId, body.data), { headers: privateMediaHeaders }); }
  catch (error) { return privateMediaHttpError(error); }
}
