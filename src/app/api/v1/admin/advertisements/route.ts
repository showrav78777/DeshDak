import { randomBytes } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { advertisementCreateSchema, advertisementUpdateSchema } from "@/modules/advertisements/schemas";

async function admin(request: NextRequest) {
  const session = await getRequestSession(request);
  return session?.portal === "admin" && session.roles.includes(ROLE.ADMIN) ? session : null;
}

export async function GET(request: NextRequest) {
  if (!(await admin(request))) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const advertisements = await prisma.advertisement.findMany({ orderBy: [{ createdAt: "desc" }], take: 100 });
  return apiSuccess({ advertisements }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await admin(request);
  if (!session) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = advertisementCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the advertisement content, placement, links, and schedule.", 422, z.treeifyError(parsed.error));
  const advertisement = await prisma.$transaction(async (tx) => {
    const created = await tx.advertisement.create({ data: { ...parsed.data, body: parsed.data.body || null, imageUrl: parsed.data.imageUrl || null, altText: parsed.data.altText || null, pagePath: parsed.data.pagePath || null, startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null, endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null, adCode: `AD-${randomBytes(8).toString("hex").toUpperCase()}`, createdById: session.userId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "advertisement.created", entityType: "Advertisement", entityId: created.id, metadata: { adCode: created.adCode, placement: created.placement, status: created.status } } });
    return created;
  });
  return apiSuccess({ advertisement }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: NextRequest) {
  const session = await admin(request);
  if (!session) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = advertisementUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose an advertisement and valid status.", 422);
  const existing = await prisma.advertisement.findUnique({ where: { id: parsed.data.id }, select: { id: true, status: true, adCode: true } });
  if (!existing) return apiError("ADVERTISEMENT_NOT_FOUND", "Advertisement was not found.", 404);
  const advertisement = await prisma.$transaction(async (tx) => {
    const content = parsed.data.content;
    const updated = await tx.advertisement.update({ where: { id: existing.id }, data: content ? { ...content, status: parsed.data.status, body: content.body || null, imageUrl: content.imageUrl || null, altText: content.altText || null, pagePath: content.pagePath || null, startsAt: content.startsAt ? new Date(content.startsAt) : null, endsAt: content.endsAt ? new Date(content.endsAt) : null } : { status: parsed.data.status } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: content ? "advertisement.content_updated" : "advertisement.status_changed", entityType: "Advertisement", entityId: updated.id, metadata: { adCode: updated.adCode, from: existing.status, to: updated.status } } });
    return updated;
  });
  return apiSuccess({ advertisement }, { headers: { "Cache-Control": "private, no-store" } });
}
