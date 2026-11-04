import { AiCapability, AiConfigurationStatus, AiConversationMessageRole, AiConversationStatus, Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { requestMarketCountry } from "@/lib/customer-market";
import { convertMarketAmount, getMarketMoneyContext } from "@/lib/market-money";
import { answerPublicShoppingQuestion } from "@/modules/ai/chat-assistant";
import { AI_CHAT_COOKIE, aiChatRetentionMinutes, clearAiChatCookie, createAiChatToken, findAiConversation, setAiChatCookie } from "@/modules/ai/chat-session";
import { getAiConfiguration } from "@/modules/ai/configuration";
import { checkPublicAiRateLimit } from "@/modules/ai/public-rate-limit";

const schema = z.object({
  message: z.string().trim().min(2).max(500).refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), "The message contains unsupported control characters."),
  turnKey: z.string().uuid(),
}).strict();
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function publicMessages(messages: { role: AiConversationMessageRole; body: string; handoffSuggested: boolean; createdAt: Date }[]) {
  return messages.map((message) => ({ role: message.role === AiConversationMessageRole.USER ? "user" : "assistant", text: message.body, handoffSuggested: message.handoffSuggested, createdAt: message.createdAt }));
}

export async function GET(request: NextRequest) {
  const configuration = await getAiConfiguration(AiCapability.CHATBOT);
  if (configuration.status !== AiConfigurationStatus.LIVE) return apiError("CHAT_TEMPORARILY_DISABLED", "The shopping assistant is temporarily unavailable.", 503);
  const rate = await checkPublicAiRateLimit(request, "public-shopping-chat-history", Math.max(20, configuration.anonymousLimit * 2));
  if (!rate.allowed) {
    const response = apiError("CHAT_RATE_LIMITED", "Too many assistant requests. Please wait before continuing.", 429, { retryAfterSeconds: rate.retryAfterSeconds });
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }
  const conversation = await findAiConversation(request, true);
  if (!conversation) return apiSuccess({ messages: [], status: "EMPTY", handoffCompleted: false }, { headers: noStore });
  if (conversation.expiresAt <= new Date()) {
    await prisma.aiConversation.updateMany({ where: { id: conversation.id, status: AiConversationStatus.ACTIVE }, data: { status: AiConversationStatus.EXPIRED } });
    const response = apiSuccess({ messages: [], status: "EXPIRED", handoffCompleted: false }, { headers: noStore });
    clearAiChatCookie(response);
    return response;
  }
  return apiSuccess({ messages: publicMessages(conversation.messages), status: conversation.status, handoffCompleted: conversation.status === AiConversationStatus.HANDED_OFF }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const configuration = await getAiConfiguration(AiCapability.CHATBOT);
  if (configuration.status !== AiConfigurationStatus.LIVE) return apiError("CHAT_TEMPORARILY_DISABLED", "The shopping assistant is temporarily unavailable.", 503);
  const rate = await checkPublicAiRateLimit(request, "public-shopping-chat", configuration.anonymousLimit);
  if (!rate.allowed) {
    const response = apiError("HUMAN_VERIFICATION_REQUIRED", "Too many anonymous assistant messages. Please wait and verify you are human before continuing.", 429, { retryAfterSeconds: rate.retryAfterSeconds });
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Enter a message of 2 to 500 characters.", 422);
  const now = new Date();
  const retentionMinutes = aiChatRetentionMinutes(configuration.retentionMinutes);
  const expiresAt = new Date(now.getTime() + retentionMinutes * 60_000);
  let conversation = await findAiConversation(request, true);
  if (conversation && (conversation.expiresAt <= now || conversation.status !== AiConversationStatus.ACTIVE)) conversation = null;
  if (conversation) {
    const replay = conversation.messages.find((message) => message.turnKey === parsed.data.turnKey && message.role === AiConversationMessageRole.ASSISTANT);
    if (replay) return apiSuccess({ answer: replay.body, products: [], requiresLogin: false, handoffSuggested: replay.handoffSuggested, idempotentReplay: true }, { headers: noStore });
    const turns = conversation.messages.filter((message) => message.role === AiConversationMessageRole.USER).length;
    if (turns >= Math.min(50, Math.max(10, configuration.anonymousLimit))) return apiError("CHAT_SESSION_LIMIT_REACHED", "This public conversation reached its safe message limit. Start a new conversation later or sign in and request Customer Service.", 429);
  }
  const session = await getRequestSession(request);
  const marketCountry = await requestMarketCountry(request, session);
  const history = conversation?.messages.map((message) => ({ role: message.role === AiConversationMessageRole.USER ? "user" as const : "assistant" as const, text: message.body }));
  const answer = await answerPublicShoppingQuestion(parsed.data.message, marketCountry, history);
  const money = await getMarketMoneyContext(marketCountry, session?.identityRoles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const displayProducts = answer.products.map((product) => ({ ...product, variants: product.variants.map((variant) => ({ ...variant, displayPrice: convertMarketAmount(variant.priceBdt, money), displayCurrency: money.currency })) }));
  const generated = conversation ? null : createAiChatToken();
  try {
    await prisma.$transaction(async (tx) => {
      const target = conversation
        ? await tx.aiConversation.update({ where: { id: conversation.id }, data: { expiresAt, lastMessageAt: now } })
        : await tx.aiConversation.create({ data: { tokenHash: generated!.tokenHash, expiresAt, lastMessageAt: now } });
      await tx.aiConversationMessage.createMany({ data: [
        { conversationId: target.id, turnKey: parsed.data.turnKey, role: AiConversationMessageRole.USER, body: parsed.data.message },
        { conversationId: target.id, turnKey: parsed.data.turnKey, role: AiConversationMessageRole.ASSISTANT, body: answer.answer, safetyCode: answer.safetyCode, handoffSuggested: answer.handoffSuggested },
      ] });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const response = apiSuccess({ answer: answer.answer, products: displayProducts, requiresLogin: answer.requiresLogin, loginUrl: answer.loginUrl, handoffSuggested: answer.handoffSuggested, idempotentReplay: false }, { status: 201, headers: noStore });
    setAiChatCookie(response, generated?.token ?? request.cookies.get(AI_CHAT_COOKIE)!.value, retentionMinutes);
    return response;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002" && conversation) {
      const replay = await prisma.aiConversationMessage.findFirst({ where: { conversationId: conversation.id, turnKey: parsed.data.turnKey, role: AiConversationMessageRole.ASSISTANT } });
      if (replay) return apiSuccess({ answer: replay.body, products: [], requiresLogin: false, handoffSuggested: replay.handoffSuggested, idempotentReplay: true }, { headers: noStore });
    }
    throw error;
  }
}
