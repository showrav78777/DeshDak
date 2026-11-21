import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createMediaLifecycle } from "@/modules/private-storage/lifecycle";
import { mediaPreviewQuery } from "@/modules/private-storage/eligibility";
import { privateMediaHeaders, privateMediaHttpAccess, privateMediaHttpError } from "@/modules/private-storage/lifecycle-http";
export async function GET(request: NextRequest) {
  const access = await privateMediaHttpAccess(request);
  if (access.error) return access.error;
  const query = mediaPreviewQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return apiError("VALIDATION_ERROR", "Choose a valid purpose and preview page.", 422);
  try { return apiSuccess(await createMediaLifecycle(prisma).preview(access.session!.sessionId, query.data), { headers: privateMediaHeaders }); }
  catch (error) { return privateMediaHttpError(error); }
}
