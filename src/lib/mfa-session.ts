import { type NextRequest } from "next/server";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function getPendingPrivilegedSession(request: NextRequest) {
  const session = await getRequestSession(request);
  if (session?.portal === "admin" && session.identityRoles.includes(ROLE.ADMIN)) return session;
  if (session?.portal === "compliance" && session.identityRoles.includes(ROLE.COMPLIANCE)) return session;
  if (session?.portal === "finance" && session.identityRoles.includes(ROLE.FINANCE)) return session;
  return null;
}

export function hasTrustedMutationOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}
