import "server-only";
import { prisma } from "@/lib/prisma";
import { appearanceSchema, defaultAppearance } from "./appearance";

export async function readWebsiteAppearance() {
  try {
    const record = await prisma.websiteAppearance.findUnique({ where: { id: "main" } });
    const parsed = appearanceSchema.safeParse(record?.content);
    return { content: parsed.success ? parsed.data : defaultAppearance, version: record?.version ?? 0, ready: true };
  } catch (error) {
    // Only an unapplied table migration receives the default artwork. Connectivity
    // and other database failures must remain visible to operations monitoring.
    if ((error as { code?: string }).code !== "P2021") throw error;
    return { content: defaultAppearance, version: 0, ready: false };
  }
}

export async function readWebsiteDraft() {
  try {
    const record=await prisma.websiteAppearanceDraft.findUnique({where:{id:"main"}});
    const parsed=appearanceSchema.safeParse(record?.content);
    return {content:parsed.success?parsed.data:null,version:record?.version??0,ready:true};
  }catch(error){
    if((error as {code?:string}).code!=="P2021")throw error;
    return {content:null,version:0,ready:false};
  }
}
