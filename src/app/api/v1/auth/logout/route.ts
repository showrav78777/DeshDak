import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { recordUserEvent } from "@/modules/activity/service";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  // These writes have no data dependency. Submit them atomically as a batch so
  // application scheduling cannot expire a callback's interactive transaction.
  // Cookies are cleared only after revocation and its evidence commit together.
  if (session) await prisma.$transaction([
    prisma.authSession.updateMany({ where: { id: session.sessionId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({ data: { actorId: session.userId, action: "auth.session_revoked", entityType: "AuthSession", entityId: session.sessionId } }),
    recordUserEvent(prisma, { userId: session.userId, authSessionId: session.sessionId, category: "SECURITY", eventType: "AUTH_LOGOUT", objectType: "AuthSession", objectId: session.sessionId }),
  ]);
  const response = NextResponse.json({ data: { loggedOut: true, redirectTo: "/" } });
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0, expires: new Date(0) });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Clear-Site-Data", '"cache", "cookies", "storage"');
  return response;
}
