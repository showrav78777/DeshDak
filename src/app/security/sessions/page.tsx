import { redirect } from "next/navigation";
import { CustomerNav } from "@/components/store-header";
import { SessionManagement, type ManagedSession } from "@/components/session-management";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.portal === "admin") redirect("/admin");
  if (session.portal === "seller") redirect("/seller/dashboard");
  const records = await prisma.authSession.findMany({
    where: { userId: session.userId },
    select: { id: true, portal: true, clientName: true, clientType: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true },
    orderBy: { lastSeenAt: "desc" },
    take: 25,
  });
  const now = new Date();
  const initialSessions: ManagedSession[] = records.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), lastSeenAt: item.lastSeenAt.toISOString(), expiresAt: item.expiresAt.toISOString(), revokedAt: item.revokedAt?.toISOString() ?? null, isCurrent: item.id === session.sessionId, isActive: !item.revokedAt && item.expiresAt > now }));
  return <main className="dashboard-shell session-security-shell"><CustomerNav session={session} /><section className="session-security-page"><p className="eyebrow">ACCOUNT SECURITY</p><h1>Devices and sessions.</h1><p className="session-security-intro">Review your most recent browsers and devices. Close anything you do not recognize. The current browser remains protected until you use the normal Sign out action.</p><SessionManagement initialSessions={initialSessions} /></section></main>;
}
