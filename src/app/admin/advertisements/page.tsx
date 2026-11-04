import { redirect } from "next/navigation";
import { AdminAdvertisementManager } from "@/components/admin-advertisement-manager";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminAdvertisementsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const advertisements = await prisma.advertisement.findMany({ select: { id: true, adCode: true, advertiserName: true, title: true, body: true, imageUrl: true, altText: true, targetUrl: true, displayOrder: true, isDismissible: true, placement: true, pagePath: true, status: true, startsAt: true, endsAt: true }, orderBy: [{ createdAt: "desc" }], take: 100 });
  return <main className="dashboard-shell"><section className="admin-content"><p className="eyebrow">ADVERTISING OPERATIONS</p><h1>Website advertisements.</h1><p className="admin-intro">Manage multiple company campaigns, entry pop-ups, global banners, and page-specific placements without changing code.</p><AdminAdvertisementManager advertisements={advertisements} /></section></main>;
}
