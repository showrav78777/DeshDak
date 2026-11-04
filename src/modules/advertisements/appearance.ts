import { z } from "zod";

const image = z.string().max(1000).refine((value) => {
  if (/^\/api\/v1\/website-media\/[a-f0-9-]{36}$/.test(value)) return true;
  if (/^\/(?:brand|images)\/[a-zA-Z0-9/_.-]+$/.test(value)) return !value.split("/").some((part) => part === "." || part === "..");
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash; } catch { return false; }
}, "Use an approved local asset or HTTPS image address without embedded credentials.");
export function promotionalVideoEmbed(value:string) {
  try { const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password)return null;
    const id=url.hostname==="youtu.be"?url.pathname.slice(1):["www.youtube.com","youtube.com"].includes(url.hostname)?url.searchParams.get("v"):null;
    return id&&/^[a-zA-Z0-9_-]{11}$/.test(id)?`https://www.youtube-nocookie.com/embed/${id}`:null;
  } catch{return null;}
}
export const homepageSectionLabels = { searches:"Popular searches", discovery:"Shopping assistant introduction", recommendations:"Recommended products", reels:"Product videos", featured:"Featured product", stores:"Bangladesh stores", services:"Shopping and delivery services", categories:"Category highlights", steps:"How Buy & Ship works", trust:"Shopping confidence", promotionVideo:"Promotional video" } as const;
export const defaultHomepageSections = Object.keys(homepageSectionLabels).map(id=>({id:id as keyof typeof homepageSectionLabels,enabled:true}));
export function safeBannerDestination(value:string) {
  if(/[\\\u0000-\u001f\u007f]/.test(value))return false;
  if(value.startsWith('/'))return !value.startsWith('//');
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}
export const appearanceSchema = z.object({
  logo: image,
  video:z.object({url:z.string().max(1000).refine(value=>Boolean(promotionalVideoEmbed(value)),"Enter a YouTube watch or youtu.be video link."),title:z.string().trim().min(3).max(160),enabled:z.boolean()}).strict().nullable().default(null),
  sections: z.array(z.object({id:z.enum(Object.keys(homepageSectionLabels) as [keyof typeof homepageSectionLabels,...(keyof typeof homepageSectionLabels)[]]),enabled:z.boolean()}).strict()).max(11).refine(items=>new Set(items.map(item=>item.id)).size===items.length,"Each homepage section may appear only once.").default(defaultHomepageSections),
  slides: z.array(z.object({ src: image, mobileSrc: image.optional(), alt: z.string().trim().min(3).max(200), title: z.string().trim().max(100), copy: z.string().trim().max(250), targetUrl:z.string().trim().max(1000).refine(safeBannerDestination,"Use a site path or HTTPS destination without credentials.").optional(),buttonLabel:z.string().trim().min(2).max(40).optional(), enabled: z.boolean(), startsAt:z.iso.datetime({offset:true}).optional(), endsAt:z.iso.datetime({offset:true}).optional() }).strict().refine(slide=>Boolean(slide.targetUrl)===Boolean(slide.buttonLabel),"Set both banner button text and destination, or leave both blank.").refine(slide=>!slide.startsAt||!slide.endsAt||new Date(slide.endsAt)>new Date(slide.startsAt),"Banner expiration must be after its publishing date.")).min(1).max(10),
}).strict().refine((value) => value.slides.some((slide) => slide.enabled), "Keep at least one banner enabled.");
export type Appearance = z.infer<typeof appearanceSchema>;
export function bannerIsPublished(slide:Appearance["slides"][number],now=new Date()) {
  return slide.enabled && (!slide.startsAt || new Date(slide.startsAt)<=now) && (!slide.endsAt || new Date(slide.endsAt)>now);
}
export const defaultAppearance: Appearance = { logo: "/brand/deshdak-mark-v2.webp", video:null, sections:defaultHomepageSections, slides: [
  { src: "/brand/deshdak-worldwide.webp", alt: "DeshDak — Connecting Bangladesh to the World", title: "", copy: "", enabled: true },
  { src: "/images/duar-global-marketplace-hero-v1.png", alt: "International shopping and delivery", title: "Discover more. Shop worldwide.", copy: "Find your next product or send us a link to get started.", enabled: true },
] };
