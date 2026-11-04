import { type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/session";

export async function getRequestSession(request: NextRequest): Promise<SessionPayload | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}
