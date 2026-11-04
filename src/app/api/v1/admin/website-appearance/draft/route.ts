import {type NextRequest} from "next/server";
import {apiError,apiSuccess} from "@/lib/api";
import {prisma} from "@/lib/prisma";
import {getRequestSession} from "@/lib/request-session";
import {ROLE} from "@/lib/roles";
import {appearanceSchema} from "@/modules/advertisements/appearance";

async function mutate(request:NextRequest,discard:boolean) {
  const session=await getRequestSession(request);
  if(session?.portal!=="admin"||!session.roles.includes(ROLE.ADMIN))return apiError("ADMIN_ACCESS_REQUIRED","Administrator access is required.",403);
  const body=await request.json().catch(()=>null);
  const parsed=appearanceSchema.safeParse(body?.content);
  if(!Number.isSafeInteger(body?.version)||body.version<0||(!discard&&!parsed.success))return apiError("VALIDATION_ERROR",parsed.error?.issues[0]?.message??"Invalid draft version.",422);
  try {
    const version=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(829321)`;
      const current=await tx.websiteAppearanceDraft.findUnique({where:{id:"main"},select:{version:true}});
      if((current?.version??0)!==body.version)throw new Error("DRAFT_CONFLICT");
      if(discard&&!current)return 0;
      if(discard)await tx.websiteAppearanceDraft.deleteMany({where:{id:"main"}});
      else if(parsed.success){
        const addresses=[parsed.data.logo,...parsed.data.slides.flatMap(slide=>[slide.src,slide.mobileSrc])];
        const ids=[...new Set(addresses.filter((value):value is string=>Boolean(value?.startsWith('/api/v1/website-media/'))).map(value=>value.split('/').at(-1)!))];
        if(ids.length&&await tx.websiteMedia.count({where:{id:{in:ids}}})!==ids.length)throw new Error("MEDIA_MISSING");
        await tx.websiteAppearanceDraft.upsert({where:{id:"main"},create:{id:"main",content:parsed.data},update:{content:parsed.data,version:{increment:1}}});
      }
      await tx.auditLog.create({data:{actorId:session.userId,action:discard?"website.draft_discarded":"website.draft_saved",entityType:"WebsiteAppearanceDraft",entityId:"main",metadata:{version:discard?0:body.version+1}}});
      return discard?0:body.version+1;
    });
    return apiSuccess({version},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    if((error as {code?:string}).code==="P2021")return apiError("SETUP_REQUIRED","Apply the website draft migration before saving drafts.",503);
    if(error instanceof Error&&error.message==="DRAFT_CONFLICT")return apiError("DRAFT_CONFLICT","Another employee changed this draft. Reload before saving or publishing.",409);
    if(error instanceof Error&&error.message==="MEDIA_MISSING")return apiError("MEDIA_MISSING","A selected library image was removed. Choose another image.",422);
    throw error;
  }
}
export async function PUT(request:NextRequest){return mutate(request,false);}
export async function DELETE(request:NextRequest){return mutate(request,true);}
