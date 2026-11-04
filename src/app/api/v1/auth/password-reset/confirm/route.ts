import bcrypt from "bcryptjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifyHuman } from "@/lib/human-verification";
import { SESSION_COOKIE } from "@/lib/session";
import { consumeConfirmationLimit, clearLoginAccountLimit } from "@/modules/auth/rate-limit";
import { newPasswordSchema } from "@/modules/auth/password";
import { tokenHash } from "@/modules/auth/security-token-service";
import { recordUserEvent } from "@/modules/activity/service";

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: newPasswordSchema, confirmPassword: z.string() }).refine((value) => value.password === value.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] });

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const verificationToken = typeof body === "object" && body ? (body as Record<string, unknown>).humanVerificationToken ?? (body as Record<string, unknown>)["cf-turnstile-response"] : undefined;
  if (!(await verifyHuman(request, typeof verificationToken === "string" ? verificationToken : undefined, "password_reset_confirm"))) return apiError("HUMAN_VERIFICATION_FAILED", "Please complete human verification and try again.", 403);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Use a strong matching password and a valid reset link.", 422, z.treeifyError(parsed.error));
  const limit = await consumeConfirmationLimit(request, "password-reset-confirm");
  if (!limit.allowed) { const response = apiError("TOO_MANY_REQUESTS", "Too many attempts. Please wait before trying again.", 429); response.headers.set("Retry-After", String(limit.retryAfterSeconds)); return response; }
  const now = new Date(); const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const result = await prisma.$transaction(async (tx) => {
    const token = await tx.securityToken.findUnique({ where: { tokenHash: tokenHash("PASSWORD_RESET", parsed.data.token) }, include: { user: { select: { id: true, email: true, deletedAt: true, roles: { select: { role: { select: { code: true } } } } } } } });
    const privileged = token?.user.roles.some(({ role }) => ["admin", "finance", "compliance"].includes(role.code));
    if (!token || privileged || token.purpose !== "PASSWORD_RESET" || token.usedAt || token.expiresAt <= now || token.user.deletedAt) return null;
    const consumed = await tx.securityToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (consumed.count !== 1) return null;
    await tx.user.update({ where: { id: token.user.id }, data: { passwordHash } });
    const revoked = await tx.authSession.updateMany({ where: { userId: token.user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.securityToken.updateMany({ where: { userId: token.user.id, usedAt: null }, data: { usedAt: now } });
    await tx.notification.create({ data: { userId: token.user.id, eventType: "PASSWORD_RESET_SUCCEEDED", category: "SECURITY", priority: "CRITICAL", title: "Your password was changed", body: "Your DeshDak password was changed and all existing sessions were signed out. Contact support immediately if this was not you.", titleBn: "আপনার পাসওয়ার্ড পরিবর্তন হয়েছে", bodyBn: "আপনার DeshDak পাসওয়ার্ড পরিবর্তন করা হয়েছে এবং সব বিদ্যমান সেশন সাইন আউট হয়েছে। এটি আপনি না করলে অবিলম্বে সহায়তায় যোগাযোগ করুন।", entityType: "User", entityId: token.user.id, idempotencyKey: `password-reset-succeeded:${token.id}`, deliveries: { create: [{ channel: "IN_APP", status: "DELIVERED", deliveredAt: now, idempotencyKey: `password-reset-succeeded:${token.id}:in-app` }, { channel: "EMAIL", status: "QUEUED", nextAttemptAt: now, idempotencyKey: `password-reset-succeeded:${token.id}:email` }] } } });
    await tx.auditLog.create({ data: { actorId: token.user.id, action: "auth.password_reset_completed", entityType: "User", entityId: token.user.id, metadata: { securityTokenId: token.id, revokedSessionCount: revoked.count } } });
    await recordUserEvent(tx, { userId: token.user.id, category: "SECURITY", eventType: "PASSWORD_RESET_SUCCEEDED", objectType: "User", objectId: token.user.id, metadata: { revokedSessionCount: revoked.count } });
    return token.user;
  });
  if (!result) return apiError("PASSWORD_RESET_LINK_INVALID", "This password-reset link is invalid or expired.", 422);
  await clearLoginAccountLimit(result.email);
  const response: NextResponse = apiSuccess({ reset: true, nextAction: "SIGN_IN" }, { headers: { "Cache-Control": "no-store, max-age=0", "Clear-Site-Data": '"cache", "cookies", "storage"' } });
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0, expires: new Date(0) });
  return response;
}
