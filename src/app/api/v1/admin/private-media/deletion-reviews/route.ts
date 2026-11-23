import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createMediaLifecycle, mediaDeletionQuery, mediaDeletionRequest } from "@/modules/private-storage/lifecycle";
import { privateMediaHeaders, privateMediaHttpAccess, privateMediaHttpError } from "@/modules/private-storage/lifecycle-http";
export async function GET(request: NextRequest) {
  const access = await privateMediaHttpAccess(request);
  if (access.error) return access.error;
  const query = mediaDeletionQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return apiError("VALIDATION_ERROR", "Choose a valid review page and state.", 422);
  try { return apiSuccess(await createMediaLifecycle(prisma).deletionReviews(access.session!.sessionId, query.data), { headers: privateMediaHeaders }); }
  catch (error) { return privateMediaHttpError(error); }
}
export async function POST(request: NextRequest) {
  const access = await privateMediaHttpAccess(request, true);
  if (access.error) return access.error;
  const body = mediaDeletionRequest.safeParse(access.body);
  if (!body.success) return apiError("VALIDATION_ERROR", "Complete the review request and confirmation.", 422);
  try { return apiSuccess(await createMediaLifecycle(prisma).requestDeletionReview(access.session!.sessionId, body.data), { headers: privateMediaHeaders }); }
  catch (error) { return privateMediaHttpError(error); }
}
