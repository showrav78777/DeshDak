import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { launchReadinessCreateSchema } from "@/modules/launch-readiness/schemas";
import { getTechnicalReadinessSignals } from "@/modules/launch-readiness/technical-signals";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const [items, technicalSignals] = await Promise.all([prisma.launchReadinessItem.findMany({ include: { updatedBy: { select: { fullName: true, personCode: true } }, verifiedBy: { select: { fullName: true, personCode: true } }, events: { include: { actor: { select: { fullName: true, personCode: true } } }, orderBy: { occurredAt: "desc" }, take: 20 } }, orderBy: [{ isRequired: "desc" }, { category: "asc" }, { title: "asc" }] }), getTechnicalReadinessSignals()]);
  return apiSuccess({ items, technicalSignals }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This change must originate from the protected Admin application.", 403);
  const parsed = launchReadinessCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the launch requirement.", 422);
  const itemId = randomUUID();
  // Generate the identity first so the record, initial event and audit can be
  // submitted atomically without holding an interactive transaction open.
  const [item] = await prisma.$transaction([
    prisma.launchReadinessItem.create({ data: { ...parsed.data, id: itemId, key: `custom-${randomUUID()}`, status: "NOT_STARTED", version: 1, createdById: session.userId, updatedById: session.userId, events: { create: { actorId: session.userId, fromStatus: null, toStatus: "NOT_STARTED", itemVersion: 1, ownerNameSnapshot: parsed.data.ownerName, dueAtSnapshot: parsed.data.dueAt } } } }),
    prisma.auditLog.create({ data: { actorId: session.userId, action: "launch_readiness.item_created", entityType: "LaunchReadinessItem", entityId: itemId, metadata: { category: parsed.data.category, title: parsed.data.title, isRequired: parsed.data.isRequired } } }),
  ]);
  return apiSuccess({ item }, { status: 201 });
}
