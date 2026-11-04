import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin-shell";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value; const session = token ? await verifySession(token) : null;
  if (session?.identityRoles.includes(ROLE.ADMIN) && session.mfaRequired && !session.mfaVerifiedAt) redirect("/security/mfa");
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return children;
  return <Suspense fallback={children}><AdminShell adminName={session.fullName}>{children}</AdminShell></Suspense>;
}
