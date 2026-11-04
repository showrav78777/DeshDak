import { apiSuccess } from "@/lib/api";
import { readWebsiteAppearance } from "@/modules/advertisements/appearance-store";
import { bannerIsPublished } from "@/modules/advertisements/appearance";

export async function GET() {
  const { content } = await readWebsiteAppearance();
  return apiSuccess({ ...content, video:content.video?.enabled?content.video:null, slides: content.slides.filter((slide) => bannerIsPublished(slide)) }, { headers: { "Cache-Control": "no-store" } });
}
