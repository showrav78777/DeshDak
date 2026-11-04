import type { Metadata } from "next";
import { PublicAiDiscovery } from "@/components/public-ai-discovery";
import { StoreHeader } from "@/components/store-header";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ask DeshDak",
  description: "Ask DeshDak to find public products and explain shopping and shipping.",
  robots: { index: false, follow: true },
};

export default async function AssistantPage() {
  const session = await getServerSession();
  return <main className="public-discovery-page">
    <StoreHeader session={session} />
    <section className="ai-discovery-hero"><p className="eyebrow">DeshDak SHOPPING ASSISTANT</p><h1>Ask. Discover. Shop.</h1><p>Find approved products or get clear answers about delivery, sourcing, Reels, Buy & Ship, and Ship for Me.</p></section>
    <section className="ai-discovery-wrap"><PublicAiDiscovery initialTab="chat" /></section>
  </main>;
}
