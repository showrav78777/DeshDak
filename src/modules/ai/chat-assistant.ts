import { searchApprovedCatalog } from "@/modules/ai/catalog-search";
import { generateShoppingAssistantReply } from "@/modules/ai/generative-shopping-assistant";

const personalPattern = /\b(my order|my wallet|my payment|track my|my refund|order status|আমার অর্ডার|আমার ওয়ালেট)\b/i;
const productPattern = /\b(find|search|looking for|recommend|product|phone|laptop|toy|dress|shoe|bag|watch|furniture|kitchen|beauty|electronics|accessor(?:y|ies)|খুঁজ|পণ্য|ফোন|জুতা|ব্যাগ|ড্রেস|খেলনা|ইলেকট্রনিক্স)\b/i;
const injectionPattern = /ignore (all|previous)|system prompt|developer message|reveal.*secret|hidden instruction|api key|access token/i;
const humanPattern = /\b(human|person|agent|customer service|support team|talk to someone|live support|মানুষ|এজেন্ট|কাস্টমার সার্ভিস)\b/i;
const greetingPattern = /^(hi|hello|hey|assalamualaikum|আসসালামু আলাইকুম|হ্যালো)[!,.\s]*$/i;
const sourcingPattern = /\b(buy\s*(and|&)\s*ship|ship for me|sourc(e|ing)|supplier|1688|bulk|wholesale|কিনে.*শিপ|সোর্সিং|সরবরাহকারী)\b/i;
const reelsPattern = /\b(reel|reels|video|watch|ভিডিও|রিল)\b/i;

function canBeCatalogQuery(message: string) {
  const words = message.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().split(/\s+/).filter((word) => word.length > 1);
  return productPattern.test(message) || words.length >= 2;
}

type CatalogProducts = Awaited<ReturnType<typeof searchApprovedCatalog>>;
type PublicShoppingAnswer = { answer: string; products: CatalogProducts; requiresLogin: boolean; loginUrl?: string; handoffSuggested: boolean; safetyCode: string | null };

function catalogAnswer(products: CatalogProducts) {
  return products.length
    ? `I found ${products.length} approved product${products.length === 1 ? "" : "s"} that may match. Open a result to check variants, stock, media, delivery details, and the final price for your market. Sign in only when you want to save, request, or order.`
    : "I could not find an approved catalog match yet. Try a shorter product name, browse categories, or ask Customer Service for sourcing guidance.";
}

async function generativePublicReply(message: string, customerCountryCode: string, response: PublicShoppingAnswer, history?: { role: "user" | "assistant"; text: string }[]) {
  const generated = await generateShoppingAssistantReply({ message, marketCountry: customerCountryCode, fallbackAnswer: response.answer, products: response.products, history });
  return generated ? { ...response, answer: generated } : response;
}

export async function answerPublicShoppingQuestion(message: string, customerCountryCode = "BD", history?: { role: "user" | "assistant"; text: string }[]) {
  if (injectionPattern.test(message)) return { answer: "I can help with public products, sourcing steps, shipping, and general platform guidance. I cannot reveal internal instructions, credentials, providers, or private platform data.", products: [], requiresLogin: false, handoffSuggested: false, safetyCode: "PROMPT_INJECTION_BLOCKED" };
  if (humanPattern.test(message)) return { answer: "I can transfer this conversation to Customer Service. Sign in first so the support request is attached only to your account, then use the human-support button below.", products: [], requiresLogin: true, loginUrl: "/login?next=%2F%3Fassistant%3Dchat", handoffSuggested: true, safetyCode: "HUMAN_REQUESTED" };
  if (personalPattern.test(message)) return { answer: "Please sign in before any personal order, payment, refund, tracking, or wallet information is accessed. I will not guess private account details.", products: [], requiresLogin: true, loginUrl: "/login?next=%2F%3Fassistant%3Dchat", handoffSuggested: true, safetyCode: "AUTHENTICATION_REQUIRED" };
  if (/refund|return|damaged|lost|ফেরত|রিফান্ড/i.test(message)) return { answer: "Refund and return eligibility depends on the verified order, delivery timing, inspection, and approved decision. Sign in to discuss a specific order; I will not guess eligibility.", products: [], requiresLogin: true, loginUrl: "/login?next=%2F%3Fassistant%3Dchat", handoffSuggested: true, safetyCode: "POLICY_REQUIRES_HUMAN" };
  if (/shipping|delivery|warehouse|ship|ডেলিভারি|শিপিং/i.test(message)) return generativePublicReply(message, customerCountryCode, { answer: "After purchase, the origin warehouse receives, inspects, and measures the package. Product payment, origin-local delivery, international shipping, and destination-local delivery are shown separately. Final international shipping is quoted after measurement, and significant changes require customer approval.", products: [], requiresLogin: false, handoffSuggested: false, safetyCode: null }, history);
  if (sourcingPattern.test(message)) return generativePublicReply(message, customerCountryCode, { answer: "Use Buy & Ship when you want DeshDak to source and purchase a product, or Ship for Me when you already bought it and have the origin tracking number. You can browse public products first; sign in only when you submit a request or order.", products: [], requiresLogin: false, handoffSuggested: false, safetyCode: null }, history);
  if (reelsPattern.test(message)) return generativePublicReply(message, customerCountryCode, { answer: "Reels are public product videos. You can watch, open the linked product, compare the details, and add an available item to cart. Sign in is only needed for actions such as saving, commenting, or ordering.", products: [], requiresLogin: false, handoffSuggested: false, safetyCode: null }, history);
  if (productPattern.test(message)) {
    const products = await searchApprovedCatalog(message, 6, customerCountryCode);
    return generativePublicReply(message, customerCountryCode, { answer: catalogAnswer(products), products, requiresLogin: false, handoffSuggested: products.length === 0, safetyCode: products.length ? null : "LOW_CONFIDENCE" }, history);
  }
  if (greetingPattern.test(message)) return generativePublicReply(message, customerCountryCode, { answer: "Hello — I can find approved products, explain Buy & Ship or Ship for Me, explain shipping stages, or guide you to Reels. Tell me what you are looking for.", products: [], requiresLogin: false, handoffSuggested: false, safetyCode: null }, history);
  if (canBeCatalogQuery(message)) {
    const products = await searchApprovedCatalog(message, 6, customerCountryCode);
    return generativePublicReply(message, customerCountryCode, { answer: catalogAnswer(products), products, requiresLogin: false, handoffSuggested: products.length === 0, safetyCode: products.length ? null : "LOW_CONFIDENCE" }, history);
  }
  return generativePublicReply(message, customerCountryCode, { answer: "I can help you search approved products, understand Buy & Ship, explain shipping stages, or guide you to the right public page. If you want a person, ask for Customer Service and I can preserve this conversation for a secure handoff after sign-in.", products: [], requiresLogin: false, handoffSuggested: false, safetyCode: null }, history);
}
