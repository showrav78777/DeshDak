import { authorizeLegacyPhotoRead } from "@/modules/private-storage/legacy-read-authorization";
import { blockQuarantinedPrivateRecord } from "@/modules/private-storage/quarantine";
import { type NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { canAccessWarehouse, getInspectorAccess, getWarehouseAccess } from "@/lib/warehouse-access";
import { decryptInspectionEvidence } from "@/modules/operations/inspection-evidence";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/operations/inspection-evidence/[evidenceId]">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to view private inspection evidence.", 401);
  const { evidenceId } = await context.params;
  const evidence = await prisma.inspectionEvidence.findUnique({ where: { id: evidenceId }, include: { package: { select: { warehouseId: true, order: { select: { customerId: true } } } } } });
  if (!evidence) return apiError("EVIDENCE_NOT_FOUND", "Inspection evidence was not found.", 404);
  const customerAllowed = session.roles.includes(ROLE.CUSTOMER_PERSONAL) && evidence.package.order.customerId === session.userId;
  const [inspectorAccess, warehouseAccess] = customerAllowed ? [null, null] : await Promise.all([getInspectorAccess(session), getWarehouseAccess(session)]);
  const staffAllowed = Boolean((inspectorAccess ?? warehouseAccess) && canAccessWarehouse(inspectorAccess ?? warehouseAccess!, evidence.package.warehouseId));
  if (!customerAllowed && !staffAllowed) return apiError("EVIDENCE_ACCESS_DENIED", "You do not have access to this inspection evidence.", 403);
  if (await blockQuarantinedPrivateRecord(prisma, "inspection", evidenceId, session.userId)) return apiError("PHOTO_QUARANTINED", "This photo is blocked pending a controlled security review.", 410);
  let bytes: Buffer;
  try { bytes = decryptInspectionEvidence(evidence); }
  catch { return apiError("EVIDENCE_UNAVAILABLE", "This evidence cannot be read securely.", 410); }
  if (await blockQuarantinedPrivateRecord(prisma, "inspection", evidenceId, session.userId)) return apiError("PHOTO_QUARANTINED", "This photo is blocked pending a controlled security review.", 410);
  if (!await authorizeLegacyPhotoRead(prisma, { userId: session.userId, sessionId: session.sessionId, kind: "inspection", subjectId: evidenceId, sha256: evidence.sha256 })) return apiError("EVIDENCE_ACCESS_DENIED", "Your access changed. Sign in again or reload before viewing this evidence.", 403);
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": evidence.mimeType, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store, max-age=0", "Content-Disposition": `inline; filename=inspection-evidence-${evidence.id}.${evidence.mediaKind === "VIDEO" ? "mp4" : "image"}`, "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
}
