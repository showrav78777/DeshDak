import type { Metadata } from "next";
import { ReelsFeed } from "@/components/reels-feed";
import { StoreHeader } from "@/components/store-header";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Product Reels", description: "Watch approved product videos from Bangladesh stores and shop directly through DeshDak.", alternates: { canonical: "/reels" } };

export default async function ReelsPage() {
  const session = await getServerSession();
  return <main className="reels-page"><StoreHeader session={session} /><header className="reels-header"><div><p className="eyebrow">PRODUCT REELS</p><h1>Watch it. Understand it. Shop it.</h1></div><p>Short product videos from approved stores. Likes, comments and saves require an account; watching and browsing remain public.</p></header><ReelsFeed /></main>;
}
