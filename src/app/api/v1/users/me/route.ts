import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { findAvailableMarketCountry } from "@/lib/customer-market";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const profileSchema = z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().trim().max(32).transform((value) => value.replace(/[\s()-]/g, "")).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)), residenceCountryCode: z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/)), locale: z.enum(["en", "bn"]), preferredCurrency: z.string().trim().regex(/^[A-Z]{3}$/), accountType: z.enum(["PERSONAL", "BUSINESS"]) });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view your account.", 401);
  const [user, authSession] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, personCode: true, fullName: true, email: true, phone: true, residenceCountryCode: true, status: true, locale: true, accountType: true, preferredCurrency: true, kycStatus: true, analyticsConsent: true, analyticsConsentAt: true, createdAt: true } }),
    prisma.authSession.findUnique({ where: { id: session.sessionId }, select: { portal: true, createdAt: true, lastSeenAt: true, expiresAt: true } }),
  ]);
  return apiSuccess({ user: user ? { ...user, roles: session.roles } : null, session: authSession }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to update your account.", 401);
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check your profile information.", 422, z.treeifyError(parsed.error));
  const currentCountry = await prisma.user.findUnique({ where: { id: session.userId }, select: { residenceCountryCode: true, phone: true } });
  if (currentCountry?.residenceCountryCode !== parsed.data.residenceCountryCode && !(await findAvailableMarketCountry(parsed.data.residenceCountryCode))) return apiError("MARKET_NOT_AVAILABLE", "That country is not currently enabled for customer accounts.", 409);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const phoneChanged = currentCountry?.phone !== parsed.data.phone;
      const updated = await tx.user.update({ where: { id: session.userId }, data: { ...parsed.data, ...(phoneChanged ? { phoneVerifiedAt: null } : {}) }, select: { id: true, personCode: true, fullName: true, email: true, phone: true, phoneVerifiedAt: true, residenceCountryCode: true, status: true, locale: true, accountType: true, preferredCurrency: true, kycStatus: true, updatedAt: true } });
      const roles = await tx.role.findMany({ where: { code: { in: [ROLE.CUSTOMER_PERSONAL, ROLE.CUSTOMER_BUSINESS] } }, select: { id: true, code: true } }); const personalRole = roles.find((role) => role.code === ROLE.CUSTOMER_PERSONAL); const businessRole = roles.find((role) => role.code === ROLE.CUSTOMER_BUSINESS); if (!personalRole || (parsed.data.accountType === "BUSINESS" && !businessRole)) throw new Error("CUSTOMER_ROLE_MISSING"); await tx.userRole.upsert({ where: { userId_roleId: { userId: session.userId, roleId: personalRole.id } }, update: {}, create: { userId: session.userId, roleId: personalRole.id } }); if (businessRole) { if (parsed.data.accountType === "BUSINESS") await tx.userRole.upsert({ where: { userId_roleId: { userId: session.userId, roleId: businessRole.id } }, update: {}, create: { userId: session.userId, roleId: businessRole.id } }); else await tx.userRole.deleteMany({ where: { userId: session.userId, roleId: businessRole.id } }); }
      await tx.auditLog.create({ data: { actorId: session.userId, action: "user.profile_updated", entityType: "User", entityId: session.userId, metadata: { fields: ["fullName", "phone", "residenceCountryCode", "locale", "preferredCurrency", "accountType"], phoneVerificationCleared: phoneChanged } } });
      return updated;
    });
    return apiSuccess({ user }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "CUSTOMER_ROLE_MISSING") return apiError("ROLE_CONFIGURATION_MISSING", "Customer role configuration is unavailable.", 503);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return apiError("PHONE_IN_USE", "Another account already uses this phone number.", 409);
    throw error;
  }
}
