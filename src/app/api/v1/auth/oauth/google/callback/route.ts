import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { sessionClientDetails } from "@/modules/auth/session-client";
import { GOOGLE_OAUTH_STATE_COOKIE, googleOauthConfigured, googleRedirectUri, oauthNextPath, readGoogleState, verifyGoogleCallback } from "@/modules/auth/google-oauth";

function destination(request: NextRequest, mode: "signin" | "signup", outcome: string) {
  return new URL(`/${mode === "signup" ? "register" : "login"}?google=${encodeURIComponent(outcome)}`, request.url);
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") === "signup" ? "signup" : "signin";
  const clearState = (response: NextResponse) => { response.cookies.set({ name: GOOGLE_OAUTH_STATE_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0, expires: new Date(0) }); response.headers.set("Cache-Control", "no-store, max-age=0"); return response; };
  if (!googleOauthConfigured()) return clearState(NextResponse.redirect(destination(request, mode, "unavailable"), 303));
  const state = await readGoogleState(request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value, request.nextUrl.searchParams.get("state"));
  if (!state) return clearState(NextResponse.redirect(destination(request, mode, "invalid_state"), 303));
  if (request.nextUrl.searchParams.get("error")) return clearState(NextResponse.redirect(destination(request, state.mode, "cancelled"), 303));
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return clearState(NextResponse.redirect(destination(request, state.mode, "failed"), 303));

  try {
    const profile = await verifyGoogleCallback({ code, redirectUri: googleRedirectUri(request.nextUrl), codeVerifier: state.codeVerifier, nonce: state.nonce });
    let user = await prisma.user.findUnique({ where: { googleSubject: profile.subject }, include: { roles: { include: { role: true } } } });
    if (!user) {
      const existingEmail = await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } });
      if (existingEmail) return clearState(NextResponse.redirect(destination(request, state.mode, "link_required"), 303));
      if (state.mode !== "signup") return clearState(NextResponse.redirect(destination(request, state.mode, "signup_required"), 303));
      const roles = await prisma.role.findMany({ where: { code: { in: [ROLE.CUSTOMER_PERSONAL, ROLE.CUSTOMER_BUSINESS] } }, select: { id: true, code: true } });
      const personal = roles.find((role) => role.code === ROLE.CUSTOMER_PERSONAL);
      const business = roles.find((role) => role.code === ROLE.CUSTOMER_BUSINESS);
      if (!personal || (state.accountType === "BUSINESS" && !business)) return clearState(NextResponse.redirect(destination(request, state.mode, "unavailable"), 303));
      const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            fullName: profile.name,
            email: profile.email,
            passwordHash,
            residenceCountryCode: state.residenceCountryCode,
            accountType: state.accountType,
            status: "ACTIVE",
            googleSubject: profile.subject,
            googleLinkedAt: new Date(),
            roles: {
              create: [
                { roleId: personal.id },
                ...(state.accountType === "BUSINESS" && business ? [{ roleId: business.id }] : []),
              ],
            },
          },
          include: { roles: { include: { role: true } } },
        });
        await tx.auditLog.create({ data: { actorId: created.id, action: "auth.google_account_created", entityType: "User", entityId: created.id, metadata: { accountType: state.accountType, residenceCountryCode: state.residenceCountryCode } } });
        return created;
      });
    }
    if (user.status === "SUSPENDED" || user.deletedAt) return clearState(NextResponse.redirect(destination(request, state.mode, "account_unavailable"), 303));
    const roles = user.roles.map(({ role }) => role.code);
    if (!roles.includes(ROLE.CUSTOMER_PERSONAL)) return clearState(NextResponse.redirect(destination(request, state.mode, "customer_required"), 303));
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    const details = sessionClientDetails(request);
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.authSession.create({ data: { userId: user!.id, portal: "customer", expiresAt, ...details } });
      await tx.auditLog.create({ data: { actorId: user!.id, action: "auth.google_session_created", entityType: "AuthSession", entityId: created.id, metadata: { clientName: details.clientName, clientType: details.clientType } } });
      return created;
    });
    const response = clearState(NextResponse.redirect(new URL(oauthNextPath(state.nextPath, "/dashboard"), request.url), 303));
    response.cookies.set({ name: SESSION_COOKIE, value: await createSession({ sessionId: session.id, userId: user.id, fullName: user.fullName, email: user.email, roles }), httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE_SECONDS, expires: expiresAt });
    return response;
  } catch {
    return clearState(NextResponse.redirect(destination(request, state.mode, "failed"), 303));
  }
}
