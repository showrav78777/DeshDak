import { createHash, randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import type { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const AI_CHAT_COOKIE = process.env.NODE_ENV === "production" ? "__Host-crossly_ai_chat" : "crossly_ai_chat";
export const AI_CHAT_DEFAULT_RETENTION_MINUTES = 24 * 60;
export const AI_CHAT_MINIMUM_RETENTION_MINUTES = 15;

export function aiChatRetentionMinutes(configured: number) {
  return configured > 0 ? Math.max(AI_CHAT_MINIMUM_RETENTION_MINUTES, Math.min(24 * 60, configured)) : AI_CHAT_DEFAULT_RETENTION_MINUTES;
}

export function hashAiChatToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createAiChatToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashAiChatToken(token) };
}

type AiConversationWithMessages = Prisma.AiConversationGetPayload<{ include: { messages: true } }>;

export function findAiConversation(request: NextRequest, includeMessages: true): Promise<AiConversationWithMessages | null>;
export function findAiConversation(request: NextRequest, includeMessages?: false): ReturnType<typeof prisma.aiConversation.findUnique>;
export async function findAiConversation(request: NextRequest, includeMessages = false) {
  const token = request.cookies.get(AI_CHAT_COOKIE)?.value;
  if (!token || token.length < 32 || token.length > 128) return null;
  if (includeMessages) return prisma.aiConversation.findUnique({ where: { tokenHash: hashAiChatToken(token) }, include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  return prisma.aiConversation.findUnique({ where: { tokenHash: hashAiChatToken(token) } });
}

export function setAiChatCookie(response: NextResponse, token: string, retentionMinutes: number) {
  response.cookies.set({ name: AI_CHAT_COOKIE, value: token, httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: retentionMinutes * 60, priority: "high" });
}

export function clearAiChatCookie(response: NextResponse) {
  response.cookies.set({ name: AI_CHAT_COOKIE, value: "", httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0, priority: "high" });
}
