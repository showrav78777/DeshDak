import { WebsiteAppearanceEditor } from "@/components/website-appearance-editor";
import { readWebsiteAppearance, readWebsiteDraft } from "@/modules/advertisements/appearance-store";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminAdvertisementManager } from "@/components/admin-advertisement-manager";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function WebsiteContentPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const appearance = await readWebsiteAppearance();
  const draft=await readWebsiteDraft();
  const advertisements = await prisma.advertisement.findMany({ select: { id: true, adCode: true, advertiserName: true, title: true, body: true, imageUrl: true, altText: true, targetUrl: true, displayOrder: true, isDismissible: true, placement: true, pagePath: true, status: true, startsAt: true, endsAt: true }, orderBy: [{ createdAt: "desc" }], take: 100 });
  return <main className="dashboard-shell"><section className="admin-content">
    <p className="eyebrow">DESHDAK WEBSITE</p><h1>Website Content Manager</h1>
    <p className="admin-intro">Create promotional content, choose where it appears, and publish when it is ready.</p>
    <section aria-labelledby="content-steps"><h2 id="content-steps">How to publish</h2><ol>
      <li>Enter a clear title, destination link and placement. For an image, provide an HTTPS image address and describe it for accessibility.</li>
      <li>For logo and homepage changes, complete the image fields and Save draft. Reload later to continue. Preview changes and publish appearance when approved.</li>
      <li>For advertisements, save as Draft while preparing content, then Activate when approved. Set placement/order and optional dates. Open the storefront to verify placement; Pause to hide an advertisement.</li>
    </ol><p>Scheduled content appears only during its active dates. Changes use the existing audited publishing API.</p></section>
    <nav aria-label="Other website content" style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "24px 0" }}>
      <Link className="button secondary" href="/admin/categories">Categories</Link>
      <Link className="button secondary" href="/admin/products">Product content</Link>
      <Link className="button secondary" href="/admin/reels">Product videos</Link>
      <Link className="button secondary" href="/" target="_blank" rel="noopener noreferrer">Open storefront ↗</Link>
    </nav>
    <aside role="note"><p><strong>Current supported tools:</strong> image uploads with cropping, reusable image library, logo and desktop/mobile banners, homepage section visibility and ordering, YouTube promotional videos, promotional text, links, placements and schedules.</p><p>Production image uploads require configured security scanning. Direct video-file uploads remain under development.</p></aside>
    {appearance.ready ? <WebsiteAppearanceEditor initial={draft.content??appearance.content} published={appearance.content} draftVersion={draft.version} draftsReady={draft.ready} version={appearance.version} /> : <section role="alert"><h2>Appearance setup required</h2><p>The deployment operator must apply the website appearance database migration before publishing is available. Existing storefront artwork remains available. See NIloy/README.md for deployment instructions.</p></section>}
    <AdminAdvertisementManager advertisements={advertisements} />
  </section></main>;
}
