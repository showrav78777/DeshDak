import bcrypt from "bcryptjs";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { verifyHuman } from "@/lib/human-verification";
import { recordUserEvent } from "@/modules/activity/service";
import { newPasswordSchema } from "@/modules/auth/password";
import { issueSecurityToken } from "@/modules/auth/security-token-service";
import { isWorldCountryCode } from "@/lib/world-countries";

const phoneSchema = z.string().trim().max(32).transform((value) => value.replace(/[\s()-]/g, "")).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));
const countryCodeSchema = z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/));
const schema = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), phone: phoneSchema, residenceCountryCode: countryCodeSchema, accountType: z.enum(["PERSONAL", "BUSINESS"]).default("PERSONAL"), password: newPasswordSchema, humanVerificationToken: z.string().max(2048).optional(), "cf-turnstile-response": z.string().max(2048).optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the registration details.", 422, z.treeifyError(parsed.error));
  if (!(await verifyHuman(request, parsed.data.humanVerificationToken ?? parsed.data["cf-turnstile-response"], "registration"))) return apiError("HUMAN_VERIFICATION_FAILED", "Please complete human verification and try again.", 403);
  const { fullName, email, phone, residenceCountryCode, accountType, password } = parsed.data;
  if (!isWorldCountryCode(residenceCountryCode)) return apiError("INVALID_COUNTRY", "Choose a valid country of residence.", 422);
  try {
    const roles = await prisma.role.findMany({ where: { code: { in: [ROLE.CUSTOMER_PERSONAL, ROLE.CUSTOMER_BUSINESS] } }, select: { id: true, code: true } });
    const personalRole = roles.find((role) => role.code === ROLE.CUSTOMER_PERSONAL); const businessRole = roles.find((role) => role.code === ROLE.CUSTOMER_BUSINESS);
    if (!personalRole || (accountType === "BUSINESS" && !businessRole)) return apiError("ROLE_CONFIGURATION_MISSING", "Customer role configuration is unavailable.", 503);
    const passwordHash = await bcrypt.hash(password, 12);
    const registration = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { fullName, email, phone, residenceCountryCode, accountType, passwordHash, status: "PENDING_VERIFICATION", roles: { create: [{ roleId: personalRole.id }, ...(businessRole && accountType === "BUSINESS" ? [{ roleId: businessRole.id }] : [])] } }, select: { id: true, fullName: true, email: true, residenceCountryCode: true, accountType: true, status: true } });
      const issued = await issueSecurityToken(tx, { id: created.id, email: created.email, locale: "bn" }, "EMAIL_VERIFICATION");
      await recordUserEvent(tx, { userId: created.id, category: "SECURITY", eventType: "ACCOUNT_REGISTERED", objectType: "User", objectId: created.id });
      await tx.auditLog.create({ data: { actorId: created.id, action: "user.registered", entityType: "User", entityId: created.id } });
      return { user: created, rawToken: issued.rawToken };
    });
    const developmentVerificationUrl = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_AUTH_LINKS === "true" ? `/verify-email#token=${encodeURIComponent(registration.rawToken)}` : undefined;
    return apiSuccess({ user: registration.user, nextAction: "VERIFY_EMAIL", developmentVerificationUrl }, { status: 201, headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (isUniqueConstraint(error)) return apiError("EMAIL_OR_PHONE_IN_USE", "An account already uses this email or phone number.", 409);
    throw error;
  }
}

function isUniqueConstraint(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
