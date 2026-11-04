"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SELLER_CATALOG_AUTH_METHODS, SELLER_CATALOG_CAPABILITIES } from "@/modules/catalog/seller-catalog-connection-fields";

export type SellerCatalogConnectionView = {
  id: string;
  systemName: string;
  apiBaseUrl: string;
  apiDocumentationUrl: string | null;
  authMethod: string;
  requestedCapabilities: string[];
  expectedProductCount: number | null;
  requestedSyncFrequencyMinutes: number | null;
  sellerNote: string | null;
  consentVersion: string;
  consentGrantedAt: string;
  consentRevokedAt: string | null;
  status: string;
  reviewNote: string | null;
  version: number;
  updatedAt: string;
  activationLocked: boolean;
};

function errorMessage(result: { error?: { message?: string } }, fallback: string) {
  return result.error?.message ?? fallback;
}

function ConnectionForm({ connection }: { connection?: SellerCatalogConnectionView }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      systemName: form.get("systemName"),
      apiBaseUrl: form.get("apiBaseUrl"),
      apiDocumentationUrl: form.get("apiDocumentationUrl"),
      authMethod: form.get("authMethod"),
      requestedCapabilities: form.getAll("requestedCapabilities"),
      expectedProductCount: form.get("expectedProductCount"),
      requestedSyncFrequencyMinutes: form.get("requestedSyncFrequencyMinutes"),
      sellerNote: form.get("sellerNote"),
      consent: form.get("consent"),
      ...(connection ? { version: connection.version } : {}),
    };
    const response = await fetch(connection ? `/api/v1/seller/catalog-connections/${connection.id}` : "/api/v1/seller/catalog-connections", { method: connection ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(errorMessage(result, "Could not submit this connection request."));
    if (!connection) event.currentTarget.reset();
    router.refresh();
  }
  return <form className="seller-connection-form" onSubmit={submit}>
    <div className="seller-connection-fields"><label>Store or catalog system name<input name="systemName" defaultValue={connection?.systemName} maxLength={100} required /></label><label>Catalog API base URL<input name="apiBaseUrl" type="url" placeholder="https://api.yourstore.com/v1" defaultValue={connection?.apiBaseUrl} required /><small>Public HTTPS only. Never include a password or API key in this URL.</small></label><label>API documentation URL <span>(optional)</span><input name="apiDocumentationUrl" type="url" placeholder="https://docs.yourstore.com/api" defaultValue={connection?.apiDocumentationUrl ?? ""} /></label><label>Authentication method<select name="authMethod" defaultValue={connection?.authMethod ?? "API_KEY"}>{SELLER_CATALOG_AUTH_METHODS.map((method) => <option key={method} value={method}>{method.replaceAll("_", " ")}</option>)}</select></label><label>Approximate number of products <span>(optional)</span><input name="expectedProductCount" type="number" min="1" max="1000000" defaultValue={connection?.expectedProductCount ?? ""} /></label><label>Requested update interval <span>(optional)</span><select name="requestedSyncFrequencyMinutes" defaultValue={connection?.requestedSyncFrequencyMinutes ?? ""}><option value="">Let DeshDak recommend</option><option value="15">Every 15 minutes</option><option value="60">Hourly</option><option value="360">Every 6 hours</option><option value="1440">Daily</option><option value="10080">Weekly</option></select></label></div>
    <fieldset><legend>Information you want DeshDak to read</legend><div className="seller-connection-capabilities">{SELLER_CATALOG_CAPABILITIES.map((capability) => <label key={capability}><input defaultChecked={connection?.requestedCapabilities.includes(capability) ?? ["PRODUCTS", "VARIANTS", "INVENTORY", "PRICES"].includes(capability)} name="requestedCapabilities" type="checkbox" value={capability} /> {capability.replaceAll("_", " ")}</label>)}</div></fieldset>
    <label>Notes for the review team <span>(optional)</span><textarea name="sellerNote" maxLength={1000} defaultValue={connection?.sellerNote ?? ""} placeholder="Explain the system owner, available API documentation, and who can help with technical access." /></label>
    <label className="seller-connection-consent"><input name="consent" type="checkbox" value="AUTHORIZE_READ_ONLY_CATALOG_REVIEW" required /> I own or am authorized to connect this catalog. I authorize DeshDak to review read-only product access and understand that no synchronization starts until technical, security, data-use, and media-rights approval is complete.</label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Submitting…" : connection ? "Resubmit for review" : "Request connection review"}</button>
  </form>;
}

function RevokeButton({ connection }: { connection: SellerCatalogConnectionView }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function revoke() {
    if (!window.confirm(`Revoke DeshDak's catalog access request for ${connection.systemName}? Saved credential references and approvals will be removed.`)) return;
    setError(""); setSaving(true);
    const response = await fetch(`/api/v1/seller/catalog-connections/${connection.id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: connection.version, confirmation: "REVOKE_CATALOG_ACCESS" }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(errorMessage(result, "Could not revoke this request."));
    router.refresh();
  }
  return <div className="seller-connection-revoke"><button className="button reject" disabled={saving} onClick={revoke} type="button">{saving ? "Revoking…" : "Revoke consent"}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}

export function SellerCatalogConnectionWorkspace({ approved, connections }: { approved: boolean; connections: SellerCatalogConnectionView[] }) {
  return <div className="seller-connection-workspace">
    {approved ? <section className="seller-connection-new"><h2>Request a catalog connection</h2><p>Use this when your store or catalog system has an official API. If it does not, continue using manual product entry or CSV import.</p><ConnectionForm /></section> : <section className="dashboard-card"><h2>Seller approval required</h2><p>Your seller account must be approved before requesting API-based catalog access.</p></section>}
    <section className="seller-connection-history"><div><h2>Your connection requests</h2><span>{connections.length} request(s)</span></div>{connections.length ? connections.map((connection) => <article className="seller-connection-card" key={connection.id}><header><div><p className="eyebrow">READ-ONLY CATALOG REQUEST</p><h3>{connection.systemName}</h3></div><span className={`status-${connection.status.toLowerCase()}`}>{connection.status.replaceAll("_", " ")}</span></header><dl><div><dt>API host</dt><dd>{new URL(connection.apiBaseUrl).hostname}</dd></div><div><dt>Access method</dt><dd>{connection.authMethod.replaceAll("_", " ")}</dd></div><div><dt>Requested data</dt><dd>{connection.requestedCapabilities.join(", ")}</dd></div><div><dt>Last updated</dt><dd>{new Date(connection.updatedAt).toLocaleString()}</dd></div></dl>{connection.reviewNote ? <aside><b>DeshDak review note</b><p>{connection.reviewNote}</p></aside> : null}{connection.status === "CHANGES_REQUESTED" ? <details open><summary>Update and resubmit</summary><ConnectionForm connection={connection} /></details> : null}{connection.status !== "REVOKED" ? <RevokeButton connection={connection} /> : <p className="seller-connection-revoked">Consent revoked {connection.consentRevokedAt ? new Date(connection.consentRevokedAt).toLocaleString() : ""}. No connection may use this request.</p>}</article>) : <div className="dashboard-card"><h3>No connection requests</h3><p>You can keep adding products manually or with the reviewed CSV workflow.</p></div>}</section>
  </div>;
}
