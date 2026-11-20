import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createMediaLifecycle, mediaReleaseRequest } from "@/modules/private-storage/lifecycle";
import { privateMediaHeaders, privateMediaHttpAccess, privateMediaHttpError } from "@/modules/private-storage/lifecycle-http";
export async function POST(request: NextRequest, context: { params: Promise<{ holdId: string }> }) {
  const access = await privateMediaHttpAccess(request, true);
  if (access.error) return access.error;
  const { holdId } = await context.params;
  const body = mediaReleaseRequest.safeParse(access.body);
  if (!z.uuid().safeParse(holdId).success || !body.success) return apiError("VALIDATION_ERROR", "Use a valid hold reference and confirmed release form.", 422);
  try { return apiSuccess(await createMediaLifecycle(prisma).releaseHold(access.session!.sessionId, holdId, body.data), { headers: privateMediaHeaders }); }
  catch (error) { return privateMediaHttpError(error); }
}
