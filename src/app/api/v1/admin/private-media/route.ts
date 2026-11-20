import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createMediaLifecycle, mediaLifecycleQuery } from "@/modules/private-storage/lifecycle";
import { privateMediaHeaders, privateMediaHttpAccess, privateMediaHttpError } from "@/modules/private-storage/lifecycle-http";
export async function GET(request: NextRequest) {
  const access = await privateMediaHttpAccess(request);
  if (access.error) return access.error;
  const query = mediaLifecycleQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return apiError("VALIDATION_ERROR", "Choose a valid page and hold filter.", 422);
  try { return apiSuccess(await createMediaLifecycle(prisma).overview(access.session!.sessionId, query.data), { headers: privateMediaHeaders }); }
  catch (error) { return privateMediaHttpError(error); }
}
