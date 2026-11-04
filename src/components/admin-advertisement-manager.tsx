"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { advertisementCreateSchema, advertisementPlacements } from "@/modules/advertisements/schemas";

type Ad = { id: string; adCode: string; advertiserName: string; title: string; body: string | null; imageUrl: string | null; altText: string | null; targetUrl: string; displayOrder: number; isDismissible: boolean; placement: string; pagePath: string | null; status: "DRAFT" | "ACTIVE" | "PAUSED"; startsAt: string | Date | null; endsAt: string | Date | null };

function localDate(value: string | Date | null | undefined) { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); }

function label(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }

export function AdminAdvertisementManager({ advertisements }: { advertisements: Ad[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Ad | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ title: string; body?: string; imageUrl?: string; altText?: string; targetUrl: string; placement: string } | null>(null);

  function showPreview(form: HTMLFormElement) {
    setPreview(null);
    try {
      const result = advertisementCreateSchema.safeParse(formContent(new FormData(form)));
      if (!result.success) { setMessage(result.error.issues.map((issue) => issue.message).join(" ")); return; }
      setMessage(""); setPreview(result.data);
    } catch { setMessage("Check the dates and content before previewing."); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget; const values = new FormData(form);
    try {
    const response = await fetch("/api/v1/admin/advertisements", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { id: editing.id, status: values.get("status"), content: formContent(values) } : formContent(values)) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(result.error?.message ?? "Advertisement could not be saved.");
    form.reset(); setEditing(null); setPreview(null); setMessage("Advertisement saved."); router.refresh();
    } catch { setMessage("Save could not be confirmed. Your entries are still here. Check the inventory before retrying."); }
    finally { setBusy(false); }
  }

  function formContent(values: FormData) {
    const date = (name: string) => { const value = String(values.get(name) ?? ""); return value ? new Date(value).toISOString() : undefined; };
    return { advertiserName: values.get("advertiserName"), title: values.get("title"), body: values.get("body") || undefined, imageUrl: values.get("imageUrl") || undefined, altText: values.get("altText") || undefined, targetUrl: values.get("targetUrl"), placement: values.get("placement"), pagePath: values.get("pagePath") || undefined, displayOrder: Number(values.get("displayOrder") || 0), startsAt: date("startsAt"), endsAt: date("endsAt"), status: values.get("status"), isDismissible: values.get("isDismissible") === "on" };
  }

  async function status(id: string, nextStatus: Ad["status"]) {
    setBusy(true); setMessage("");
    try {
    const response = await fetch("/api/v1/admin/advertisements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: nextStatus }) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(result.error?.message ?? "Status could not be changed.");
    setMessage("Advertisement status updated."); router.refresh();
    } catch { setMessage("Status change could not be confirmed. Refresh the inventory before retrying."); }
    finally { setBusy(false); }
  }

  return <div className="advertisement-admin">
    {preview ? <section aria-label="Content preview" style={{ padding: 20, border: "1px solid #ccd7e1", borderRadius: 12, marginBottom: 20, maxWidth: "100%", overflowWrap: "anywhere" }}>
      <h2>Preview — {label(preview.placement)}</h2><p>This preview is not published. Actual layout depends on the selected placement.</p>
      {preview.imageUrl ? <div>
        {/* eslint-disable-next-line @next/next/no-img-element -- approved external artwork preview; dimensions are not known until loaded */}
        <img src={preview.imageUrl} alt={preview.altText ?? ""} referrerPolicy="no-referrer" style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain" }} />
      </div> : null}
      <h3>{preview.title}</h3><p>{preview.body}</p><p>Destination: {preview.targetUrl}</p>
      <button type="button" onClick={() => setPreview(null)}>Close preview</button>
    </section> : null}
    <form key={editing?.id ?? "new"} className="advertisement-form" onSubmit={create}><h2>{editing ? "Edit advertisement" : "Create advertisement"}</h2><p>Use approved company artwork and an internal DeshDak path or secure HTTPS destination. Page path is optional; when provided, the ad appears only on that exact page.</p><div><label>Advertiser / company<input name="advertiserName" defaultValue={editing?.advertiserName ?? ""} minLength={2} maxLength={120} required /></label><label>Placement<select name="placement" defaultValue={editing?.placement ?? "GLOBAL_BANNER"}>{advertisementPlacements.map((placement) => <option key={placement} value={placement}>{label(placement)}</option>)}</select></label><label className="wide">Title<input name="title" defaultValue={editing?.title ?? ""} minLength={3} maxLength={160} required /></label><label className="wide">Short message<textarea name="body" defaultValue={editing?.body ?? ""} maxLength={500} /></label><label className="wide">Image URL<input name="imageUrl" defaultValue={editing?.imageUrl ?? ""} type="url" placeholder="https://cdn.example.com/approved-ad.jpg" /></label><label className="wide">Image description<input name="altText" defaultValue={editing?.altText ?? ""} maxLength={200} /></label><label>Destination<input name="targetUrl" defaultValue={editing?.targetUrl ?? ""} placeholder="/products or https://company.example" required /></label><label>Exact page path (optional)<input name="pagePath" defaultValue={editing?.pagePath ?? ""} placeholder="/products" /></label><label>Starts<input name="startsAt" defaultValue={localDate(editing?.startsAt)} type="datetime-local" /></label><label>Ends<input name="endsAt" defaultValue={localDate(editing?.endsAt)} type="datetime-local" /></label><label>Display order<input name="displayOrder" type="number" min="0" max="10000" defaultValue={editing?.displayOrder ?? 0} /></label><label>Status<select name="status" defaultValue={editing?.status ?? "DRAFT"}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option></select></label><label className="check wide"><input name="isDismissible" type="checkbox" defaultChecked={editing?.isDismissible ?? true} /> Visitor can dismiss this ad</label></div>{message ? <p role="status">{message}</p> : null}<button type="button" disabled={busy} onClick={(event) => { const form = event.currentTarget.form; if (form) showPreview(form); }}>Preview content</button><button className="button primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save advertisement"}</button>{editing ? <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel editing</button> : null}</form>
    <section className="advertisement-list"><h2>Advertisement inventory</h2>{advertisements.length ? advertisements.map((ad) => <article key={ad.id}><div><small>{ad.adCode} · {ad.advertiserName}</small><h3>{ad.title}</h3><span>{label(ad.placement)}{ad.pagePath ? ` · ${ad.pagePath}` : " · all customer pages"}</span></div><b className={`status-${ad.status.toLowerCase()}`}>{ad.status}</b><div><button disabled={busy} onClick={() => { setEditing(ad); setMessage(""); window.scrollTo({ top: 0, behavior: "smooth" }); }} type="button">Edit</button><button disabled={busy || ad.status === "ACTIVE"} onClick={() => void status(ad.id, "ACTIVE")} type="button">Activate</button><button disabled={busy || ad.status === "PAUSED"} onClick={() => void status(ad.id, "PAUSED")} type="button">Pause</button><button disabled={busy || ad.status === "DRAFT"} onClick={() => void status(ad.id, "DRAFT")} type="button">Draft</button></div></article>) : <p>No advertisements have been added.</p>}</section>
  </div>;
}
