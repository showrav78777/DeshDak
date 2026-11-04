import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { appearanceSchema } from "@/modules/advertisements/appearance";

export async function PUT(request: NextRequest) {
  const session = await getRequestSession(request);
  if (session?.portal !== "admin" || !session.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const body = await request.json().catch(() => null);
  const parsed = appearanceSchema.safeParse(body?.content);
  if(body?.draftVersion!==undefined&&(!Number.isSafeInteger(body.draftVersion)||body.draftVersion<0))return apiError("VALIDATION_ERROR","Invalid draft version.",422);
  if (!parsed.success || !Number.isSafeInteger(body?.version) || body.version < 0) return apiError("VALIDATION_ERROR", parsed.error?.issues[0]?.message ?? "Invalid version.", 422);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(829321)`;
      const current = await tx.websiteAppearance.findUnique({ where: { id: "main" }, select: { version: true } });
      if ((current?.version ?? 0) !== body.version) throw new Error("APPEARANCE_CONFLICT");
      const draft=await tx.websiteAppearanceDraft.findUnique({where:{id:"main"},select:{version:true}});
      if((draft?.version??0)!==(body.draftVersion??0))throw new Error("DRAFT_CONFLICT");
      const addresses = [parsed.data.logo, ...parsed.data.slides.flatMap(slide => [slide.src, slide.mobileSrc])];
      const ids = [...new Set(addresses.filter((value): value is string => Boolean(value?.startsWith("/api/v1/website-media/"))).map(value => value.split("/").at(-1)!))];
      if (ids.length && await tx.websiteMedia.count({ where: { id: { in: ids } } }) !== ids.length) throw new Error("MEDIA_MISSING");
      if (body.version === 0) await tx.websiteAppearance.create({ data: { id: "main", content: parsed.data } });
      else {
        const changed = await tx.websiteAppearance.updateMany({ where: { id: "main", version: body.version }, data: { content: parsed.data, version: { increment: 1 } } });
        if (!changed.count) throw new Error("APPEARANCE_CONFLICT");
      }
      await tx.auditLog.create({ data: { actorId: session.userId, action: "website.appearance_published", entityType: "WebsiteAppearance", entityId: "main", metadata: { version: body.version + 1 } } });
      if(draft)await tx.websiteAppearanceDraft.delete({where:{id:"main"}});
      return { version: body.version + 1 };
    });
    return apiSuccess(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if(error instanceof Error&&error.message==="DRAFT_CONFLICT")return apiError("DRAFT_CONFLICT","Another employee changed the saved draft. Reload before publishing.",409);
    if((error as {code?:string}).code==="P2021")return apiError("SETUP_REQUIRED","Apply the website appearance draft migration before publishing.",503);
    if (error instanceof Error && error.message === "MEDIA_MISSING") return apiError("MEDIA_MISSING", "One of the selected library images was removed. Choose another image.", 422);
    if ((error as { code?: string }).code === "P2002" || (error instanceof Error && error.message === "APPEARANCE_CONFLICT")) return apiError("VERSION_CONFLICT", "Another employee updated the website. Reload before saving.", 409);
    throw error;
  }
}
