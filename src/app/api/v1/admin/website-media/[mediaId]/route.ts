import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError,apiSuccess } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { appearanceSchema } from "@/modules/advertisements/appearance";

export async function DELETE(request: NextRequest, context: {params:Promise<{mediaId:string}>}) {
  const session = await getRequestSession(request);
  if (session?.portal !== "admin" || !session.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED","Administrator access is required.",403);
  const {mediaId} = await context.params;
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(829321)`;
    const record = await tx.websiteAppearance.findUnique({where:{id:"main"}});
    const appearance = appearanceSchema.safeParse(record?.content);
    const savedDraft=await tx.websiteAppearanceDraft.findUnique({where:{id:"main"}});
    const draft=appearanceSchema.safeParse(savedDraft?.content);
    const url = `/api/v1/website-media/${mediaId}`;
    if (appearance.success && (appearance.data.logo === url || appearance.data.slides.some(slide => slide.src === url || slide.mobileSrc === url))) return "IN_USE";
    if (draft.success && (draft.data.logo === url || draft.data.slides.some(slide => slide.src === url || slide.mobileSrc === url))) return "IN_USE";
    const deleted = await tx.websiteMedia.deleteMany({where:{id:mediaId}});
    if (!deleted.count) return "NOT_FOUND";
    await tx.auditLog.create({data:{actorId:session.userId,action:"website.media_deleted",entityType:"WebsiteMedia",entityId:mediaId}});
    return "DELETED";
  });
  if (result === "IN_USE") return apiError("MEDIA_IN_USE","Replace this image in the published appearance and saved draft before deleting it.",409);
  if (result === "NOT_FOUND") return apiError("NOT_FOUND","Image not found.",404);
  return apiSuccess({deleted:true},{headers:{"Cache-Control":"private, no-store"}});
}
