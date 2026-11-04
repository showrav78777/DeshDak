import { jwtVerify, SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-crossly_session" : "crossly_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

type SessionClaims = { sessionId: string; userId: string; fullName: string; email: string; roles: string[] };
export type SessionPayload = SessionClaims & { residenceCountryCode: string; portal: string; identityRoles: string[]; mfaRequired: boolean; mfaVerifiedAt: Date | null };

function getSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value === "replace-with-a-long-random-secret") throw new Error("AUTH_SECRET is not configured.");
  return new TextEncoder().encode(value);
}

export async function createSession(payload: SessionClaims) {
  return new SignJWT({ email: payload.email, name: payload.fullName, roles: payload.roles }).setProtectedHeader({ alg: "HS256" }).setJti(payload.sessionId).setSubject(payload.userId).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`).sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: process.env.AUTH_ISSUER ?? "http://localhost:3000" });
    if (!payload.sub || !payload.jti) return null;
    const authSession = await prisma.authSession.findUnique({ where: { id: payload.jti }, include: { user: { include: { roles: { include: { role: true } } } } } });
    if (!authSession || authSession.userId !== payload.sub || authSession.revokedAt || authSession.expiresAt <= new Date() || authSession.user.deletedAt || authSession.user.status === "SUSPENDED") return null;
    if (authSession.lastSeenAt < new Date(Date.now() - 60_000)) await prisma.authSession.updateMany({ where: { id: authSession.id, lastSeenAt: { lt: new Date(Date.now() - 60_000) } }, data: { lastSeenAt: new Date() } });
    const identityRoles = authSession.user.roles.map(({ role }) => role.code);
    const mfaRequired = (authSession.portal === "admin" && identityRoles.includes(ROLE.ADMIN)) || (authSession.portal === "compliance" && identityRoles.includes(ROLE.COMPLIANCE)) || (authSession.portal === "finance" && identityRoles.includes(ROLE.FINANCE));
    const roles = identityRoles.filter((role) => {
      if (role === ROLE.CUSTOMER_PERSONAL || role === ROLE.CUSTOMER_BUSINESS) return authSession.portal === "customer";
      if (role === ROLE.ADMIN) return authSession.portal === "admin" && (!mfaRequired || Boolean(authSession.mfaVerifiedAt));
      if (role === ROLE.SELLER) return authSession.portal === "seller";
      if (role === ROLE.WAREHOUSE_WORKER) return authSession.portal === "warehouse";
      if (role === ROLE.INSPECTOR) return authSession.portal === "inspector";
      if (role === ROLE.LOGISTICS_WORKER) return authSession.portal === "logistics";
      if (role === ROLE.CUSTOMER_SERVICE) return authSession.portal === "support";
      if (role === ROLE.COMPLIANCE) return authSession.portal === "compliance" && (!mfaRequired || Boolean(authSession.mfaVerifiedAt));
      if (role === ROLE.FINANCE) return authSession.portal === "finance" && (!mfaRequired || Boolean(authSession.mfaVerifiedAt));
      if (role === ROLE.SOURCING_AGENT) return authSession.portal === "sourcing";
      if (role === ROLE.KAM) return authSession.portal === "sales";
      return true;
    });
    return { sessionId: authSession.id, userId: authSession.user.id, fullName: authSession.user.fullName, email: authSession.user.email, residenceCountryCode: authSession.user.residenceCountryCode, portal: authSession.portal, roles, identityRoles, mfaRequired, mfaVerifiedAt: authSession.mfaVerifiedAt };
  } catch { return null; }
}
