import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { processWebsiteImage } from "@/modules/advertisements/media-processing";
import { scanWebsiteMedia, websiteMediaUploadsEnabled } from "@/modules/advertisements/media-scanner";

async function admin(request: NextRequest) { const session = await getRequestSession(request); return session?.portal === "admin" && session.roles.includes(ROLE.ADMIN) ? session : null; }
export async function GET(request: NextRequest) {
  if (!await admin(request)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.",403);
  const media = await prisma.websiteMedia.findMany({ select: { id:true,title:true,width:true,height:true,sizeBytes:true,createdAt:true }, orderBy: { createdAt:"desc" }, take:200 });
  return apiSuccess({ media, uploadsEnabled: websiteMediaUploadsEnabled() }, { headers: { "Cache-Control":"private, no-store" } });
}
export async function POST(request: NextRequest) {
  const session = await admin(request);
  if (!session) return apiError("ADMIN_ACCESS_REQUIRED","Administrator access is required.",403);
  if (!websiteMediaUploadsEnabled()) return apiError("SCANNING_REQUIRED","Configure the production media scanner before uploading.",503);
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > 9*1024*1024) return apiError("UPLOAD_SIZE","Provide a file upload under 8 MB with a valid content length.",413);
  const reader = request.body?.getReader();
  if (!reader) return apiError("UPLOAD_SIZE","Choose an image file.",422);
  const chunks: Uint8Array[] = []; let received = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > 9*1024*1024) { await reader.cancel(); return apiError("UPLOAD_SIZE","Upload exceeds the request limit.",413); }
      chunks.push(chunk.value);
    }
  } catch { return apiError("UPLOAD_INTERRUPTED","Upload was interrupted. Try again.",400); }
  const form = await new Response(Buffer.concat(chunks), {headers:{"Content-Type":request.headers.get("content-type") ?? ""}}).formData().catch(() => null);
  const file = form?.get("file");
  const title = String(form?.get("title") ?? "").trim();
  if (!(file instanceof File) || title.length < 2 || title.length > 120) return apiError("VALIDATION_ERROR","Choose an image and enter a title between 2 and 120 characters.",422);
  let image;
  try {
    const cropValue=form?.get("crop");
    const crop=cropValue ? JSON.parse(String(cropValue)) : undefined;
    if (crop && (typeof crop!=="object" || Array.isArray(crop) || Object.keys(crop).sort().join(",")!=="height,width,x,y")) throw new Error("Invalid crop");
    image = await processWebsiteImage(file,crop); await scanWebsiteMedia(file);
  }
  catch { return apiError("IMAGE_REJECTED","Image could not be accepted. Use a valid PNG, JPEG or WebP under 8 MB; security scanning must succeed.",422); }
  const media = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(829321)`;
    if (await tx.websiteMedia.count() >= 200) return null;
    const created = await tx.websiteMedia.create({ data:{ title,...image }, select:{id:true,title:true,width:true,height:true,sizeBytes:true,createdAt:true} });
    await tx.auditLog.create({data:{actorId:session.userId,action:"website.media_uploaded",entityType:"WebsiteMedia",entityId:created.id,metadata:{sizeBytes:image.sizeBytes}}});
    return created;
  });
  if (!media) return apiError("LIBRARY_FULL","The library limit is 200 images. Remove unused images first.",409);
  return apiSuccess({media},{status:201,headers:{"Cache-Control":"private, no-store"}});
}
