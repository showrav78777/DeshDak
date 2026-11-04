import bcrypt from "bcryptjs";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { verifyHuman } from "@/lib/human-verification";
import { recordUserEvent } from "@/modules/activity/service";
import { clearLoginAccountLimit, consumeLoginLimit } from "@/modules/auth/rate-limit";
import { sessionClientDetails } from "@/modules/auth/session-client";

const schema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), password: z.string().min(1).max(128), portal: z.enum(["customer", "seller", "admin", "warehouse", "inspector", "logistics", "support", "compliance", "finance", "sourcing", "sales"]), humanVerificationToken: z.string().max(2048).optional(), "cf-turnstile-response": z.string().max(2048).optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter a valid email and password.", 422);
  if (!(await verifyHuman(request, parsed.data.humanVerificationToken ?? parsed.data["cf-turnstile-response"], "login"))) return apiError("HUMAN_VERIFICATION_FAILED", "Please complete human verification and try again.", 403);
  const { email, password, portal } = parsed.data;
  const limit = await consumeLoginLimit(request, email);
  if (!limit.allowed) { const response = apiError("TOO_MANY_LOGIN_ATTEMPTS", "Too many sign-in attempts. Wait before trying again or reset your password.", 429); response.headers.set("Retry-After", String(limit.retryAfterSeconds)); return response; }
  const user = await prisma.user.findFirst({ where: { email, deletedAt: null }, include: { roles: { include: { role: true } }, sellerProfile: true, mfaMethod: { select: { id: true } } } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return apiError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
  if (user.status === "SUSPENDED") return apiError("ACCOUNT_SUSPENDED", "This account is suspended. Contact support.", 403);
  if (user.status === "PENDING_VERIFICATION") return apiError("EMAIL_VERIFICATION_REQUIRED", "Verify your email address before signing in.", 403);
  const roles = user.roles.map(({ role }) => role.code);
  if (portal === "customer" && !roles.some((role) => role === ROLE.CUSTOMER_PERSONAL || role === ROLE.CUSTOMER_BUSINESS)) return apiError("CUSTOMER_ACCESS_REQUIRED", "This account is not registered as a customer.", 403);
  if (portal === "seller" && !roles.includes(ROLE.SELLER)) return apiError("SELLER_ACCESS_REQUIRED", "This account is not registered as a seller.", 403);
  if (portal === "admin" && !roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (portal === "warehouse" && !roles.includes(ROLE.WAREHOUSE_WORKER)) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse Worker access is required.", 403);
  if (portal === "inspector" && !roles.includes(ROLE.INSPECTOR)) return apiError("INSPECTION_ACCESS_REQUIRED", "Inspector access is required.", 403);
  if (portal === "logistics" && !roles.includes(ROLE.LOGISTICS_WORKER)) return apiError("LOGISTICS_ACCESS_REQUIRED", "Logistics Worker access is required.", 403);
  if (portal === "support" && !roles.includes(ROLE.CUSTOMER_SERVICE)) return apiError("SUPPORT_ACCESS_REQUIRED", "Customer Service access is required.", 403);
  if (portal === "compliance" && !roles.includes(ROLE.COMPLIANCE)) return apiError("COMPLIANCE_ACCESS_REQUIRED", "Compliance access is required.", 403);
  if (portal === "finance" && !roles.includes(ROLE.FINANCE)) return apiError("FINANCE_ACCESS_REQUIRED", "Finance access is required.", 403);
  if (portal === "sourcing" && !roles.includes(ROLE.SOURCING_AGENT)) return apiError("SOURCING_ACCESS_REQUIRED", "Sourcing Agent access is required.", 403);
  if (portal === "sales" && !roles.includes(ROLE.KAM)) return apiError("KAM_ACCESS_REQUIRED", "Key Account Manager access is required.", 403);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const clientDetails = sessionClientDetails(request);
  const authSession = await prisma.$transaction(async (tx) => {
    const created = await tx.authSession.create({ data: { userId: user.id, portal, expiresAt, ...clientDetails } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "auth.session_created", entityType: "AuthSession", entityId: created.id, metadata: { portal, clientName: clientDetails.clientName, clientType: clientDetails.clientType, expiresAt: expiresAt.toISOString() } } });
    await recordUserEvent(tx, { userId: user.id, authSessionId: created.id, category: "SECURITY", eventType: "AUTH_LOGIN_SUCCEEDED", objectType: "AuthSession", objectId: created.id, metadata: { portal, clientName: clientDetails.clientName, clientType: clientDetails.clientType } });
    return created;
  });
  const nextAction = portal === "admin" || portal === "compliance" || portal === "finance" ? (user.mfaMethod ? "MFA_CHALLENGE" : "MFA_ENROLLMENT") : "SIGNED_IN";
  await clearLoginAccountLimit(email);
  const response = apiSuccess({ user: { id: user.id, fullName: user.fullName, email: user.email, roles }, session: { id: authSession.id, expiresAt }, sellerStatus: user.sellerProfile?.status ?? null, nextAction });
  // Lax keeps the session on a top-level return from an approved payment provider
  // (for example SSLCommerz) while still blocking cross-site subrequests.
  response.cookies.set({ name: SESSION_COOKIE, value: await createSession({ sessionId: authSession.id, userId: user.id, fullName: user.fullName, email: user.email, roles }), httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE_SECONDS, expires: expiresAt });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
