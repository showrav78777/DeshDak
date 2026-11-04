"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunDueCampaignsButton() {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function run() { setBusy(true); setMessage(""); const response = await fetch("/api/v1/admin/marketing-campaigns/run", { method: "POST" }); const result = await response.json(); setBusy(false); if (!response.ok) return setMessage(result.error?.message ?? "Due campaigns could not be processed."); setMessage(`Processed ${result.data.summary.examined}: ${result.data.summary.sent} sent, ${result.data.summary.failed} failed.`); router.refresh(); }
  return <div className="campaign-run-control"><button className="button secondary" disabled={busy} onClick={run} type="button">{busy ? "Processing…" : "Run due campaigns"}</button>{message ? <small role="status">{message}</small> : null}</div>;
}

export function CancelCampaignButton({ campaignId }: { campaignId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function cancel() { if (!window.confirm("Cancel this scheduled campaign? It cannot be restored.")) return; setBusy(true); const response = await fetch(`/api/v1/admin/marketing-campaigns/${campaignId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CANCEL" }) }); const result = await response.json(); setBusy(false); if (!response.ok) return setMessage(result.error?.message ?? "Campaign could not be cancelled."); setMessage("Cancelled"); router.refresh(); }
  return <div className="campaign-cancel-control"><button disabled={busy} onClick={cancel} type="button">{busy ? "Cancelling…" : "Cancel"}</button>{message ? <small role="status">{message}</small> : null}</div>;
}
