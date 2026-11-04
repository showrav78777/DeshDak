"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function SellerReelSubmission({ products }: { products: { id: string; titleEn: string; media: { id: string; altText: string | null; originalFilename: string | null }[] }[] }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [productId, setProductId] = useState(products[0]?.id ?? "");
  const videos = products.find((product) => product.id === productId)?.media ?? [];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/v1/seller/reels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: values.productId, mediaId: values.mediaId, caption: values.caption }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setMessage(result.error?.message ?? "Could not submit the Reel.");
    event.currentTarget.reset(); setMessage("Reel submitted for administrator review."); router.refresh();
  }
  if (!products.length) return <div className="dashboard-card"><h2>No eligible videos</h2><p>Add an approved video to an active product and complete the required media security scan before creating a Reel.</p></div>;
  return <form className="seller-reel-form" onSubmit={submit}><h2>Submit a product Reel</h2><p>Only approved product videos appear here. Every Reel is reviewed before publication.</p><label>Product<select name="productId" onChange={(event) => setProductId(event.target.value)} value={productId}>{products.map((product) => <option key={product.id} value={product.id}>{product.titleEn}</option>)}</select></label><label>Approved video<select name="mediaId" required>{videos.map((video) => <option key={video.id} value={video.id}>{video.altText || video.originalFilename || "Approved product video"}</option>)}</select></label><label>Caption<textarea maxLength={500} minLength={1} name="caption" required /></label>{message ? <p className={message.startsWith("Reel submitted") ? "form-success" : "form-error"} role="status">{message}</p> : null}<button className="button primary" disabled={saving || !videos.length} type="submit">{saving ? "Submitting…" : "Submit for review"}</button></form>;
}

export function SellerReelUpdate({ reel }: { reel: { id: string; caption: string | null; status: string; version: number } }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(""); const values = Object.fromEntries(new FormData(event.currentTarget)); const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    const response = await fetch(`/api/v1/seller/reels/${reel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption: values.caption, action, version: reel.version }) });
    const result = await response.json(); setSaving(false); if (!response.ok) return setMessage(result.error?.message ?? "Could not update the Reel."); setMessage("Reel updated."); router.refresh();
  }
  if (!["REJECTED", "DRAFT", "ACTIVE"].includes(reel.status)) return null;
  return <form className="seller-reel-update" onSubmit={submit}><label>Caption<textarea defaultValue={reel.caption ?? ""} maxLength={500} minLength={1} name="caption" required /></label><div>{reel.status !== "ACTIVE" ? <button className="button primary" disabled={saving} name="action" value="RESUBMIT">Resubmit</button> : null}{reel.status !== "ACTIVE" ? <button className="button secondary" disabled={saving} name="action" value="SAVE">Save draft</button> : null}<button className="button secondary" disabled={saving} name="action" value="ARCHIVE">Archive</button></div>{message ? <p className="form-error">{message}</p> : null}</form>;
}
