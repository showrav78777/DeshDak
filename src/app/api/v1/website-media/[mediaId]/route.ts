import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { appearanceSchema, bannerIsPublished } from "@/modules/advertisements/appearance";

export async function GET(request: NextRequest, context: { params: Promise<{ mediaId:string }> }) {
  const {mediaId} = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(mediaId)) return apiError("NOT_FOUND","Image not found.",404);
  const session = await getRequestSession(request);
  const isAdmin = session?.portal === "admin" && session.roles.includes(ROLE.ADMIN);
  if (!isAdmin) {
    const record = await prisma.websiteAppearance.findUnique({where:{id:"main"}});
    const parsed = appearanceSchema.safeParse(record?.content);
    const url = `/api/v1/website-media/${mediaId}`;
    if (!parsed.success || !(parsed.data.logo === url || parsed.data.slides.some(slide => bannerIsPublished(slide) && (slide.src === url || slide.mobileSrc === url)))) return apiError("NOT_FOUND","Image not found.",404);
  }
  const media = await prisma.websiteMedia.findUnique({where:{id:mediaId},select:{bytes:true}});
  if (!media) return apiError("NOT_FOUND","Image not found.",404);
  return new Response(new Uint8Array(media.bytes), {headers:{"Content-Type":"image/webp","X-Content-Type-Options":"nosniff","Cache-Control":isAdmin ? "private, no-store" : "no-store"}});
}
