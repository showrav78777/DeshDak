"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveSourceSettings } from "@/lib/source-settings-request";

type Country = { isoCode: string; name: string };
type Platform = { id: string; code: string; displayName: string; adapterKey: string | null; supportedCountries: string[]; supportsSearch: boolean; supportsOrders: boolean; supportsTracking: boolean; supportsCancellation: boolean; isActive: boolean };
type Account = { id: string; accountKey: string; displayName: string | null; countryCode: string; rateLimitPerMinute: number | null; dailyQuota: number | null; dailyQuotaUsed: number; credentialExpiresAt: string | null; isHealthy: boolean; isActive: boolean; lastHealthStatus: string | null; secretReferenceConfigured: boolean };


export function SourcePlatformCreateForm({ countries }: { countries: Country[] }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; setError(""); setSaving(true);
    try {
      const form = new FormData(element);
      await saveSourceSettings("/api/v1/admin/source-platforms", "POST", { code: form.get("code"), displayName: form.get("displayName"), adapterKey: form.get("adapterKey"), supportedCountries: form.getAll("supportedCountries"), supportsSearch: form.get("supportsSearch") === "on", supportsOrders: form.get("supportsOrders") === "on", supportsTracking: form.get("supportsTracking") === "on", supportsCancellation: form.get("supportsCancellation") === "on", isActive: false });
      element.reset(); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save settings."); }
    finally { setSaving(false); }
  }
  return <form className="integration-create-form" onSubmit={submit}><label>Internal platform code<input name="code" placeholder="FUTURE_PROVIDER" pattern="[A-Za-z0-9_]+" maxLength={50} required /></label><label>Internal display name<input name="displayName" maxLength={100} required /></label><label>Adapter key <span>(code adapter, not a secret)</span><input name="adapterKey" placeholder="FUTURE_PROVIDER_ADAPTER" pattern="[A-Za-z0-9_]+" maxLength={80} /></label><label>Supported source countries<select name="supportedCountries" multiple size={Math.min(5, Math.max(2, countries.length))}>{countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name} ({country.isoCode})</option>)}</select><small>Use Command/Ctrl to select more than one.</small></label><div className="integration-capabilities"><label><input name="supportsSearch" type="checkbox" /> Search</label><label><input name="supportsOrders" type="checkbox" /> Orders</label><label><input name="supportsTracking" type="checkbox" /> Tracking</label><label><input name="supportsCancellation" type="checkbox" /> Cancellation</label></div>{error ? <p className="form-error">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Saving…" : "Create as inactive"}</button></form>;
}

export function SourcePlatformSettingsForm({ platform, countries }: { platform: Platform; countries: Country[] }) {
  const router = useRouter(); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; setError(""); setSuccess(""); setSaving(true);
    try {
      const form = new FormData(element);
      await saveSourceSettings(`/api/v1/admin/source-platforms/${platform.id}`, "PATCH", { displayName: form.get("displayName"), adapterKey: form.get("adapterKey"), supportedCountries: form.getAll("supportedCountries"), supportsSearch: form.get("supportsSearch") === "on", supportsOrders: form.get("supportsOrders") === "on", supportsTracking: form.get("supportsTracking") === "on", supportsCancellation: form.get("supportsCancellation") === "on", isActive: platform.code === "LOCAL_SELLER" ? form.get("isActive") === "on" : false });
      setSuccess("Saved"); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save settings."); }
    finally { setSaving(false); }
  }
  return <form className="platform-settings-form" onSubmit={submit}><div className="platform-settings-grid"><label>Display name<input name="displayName" defaultValue={platform.displayName} required /></label><label>Adapter key<input name="adapterKey" defaultValue={platform.adapterKey ?? ""} /></label><label>Countries<select name="supportedCountries" multiple size={2} defaultValue={platform.supportedCountries}>{countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name} ({country.isoCode})</option>)}</select></label></div><div className="integration-capabilities"><label><input name="supportsSearch" type="checkbox" defaultChecked={platform.supportsSearch} /> Search</label><label><input name="supportsOrders" type="checkbox" defaultChecked={platform.supportsOrders} /> Orders</label><label><input name="supportsTracking" type="checkbox" defaultChecked={platform.supportsTracking} /> Tracking</label><label><input name="supportsCancellation" type="checkbox" defaultChecked={platform.supportsCancellation} /> Cancellation</label>{platform.code === "LOCAL_SELLER" ? <label><input name="isActive" type="checkbox" defaultChecked={platform.isActive} /> Active</label> : <span>External activation locked</span>}</div><div className="integration-save-row"><button className="button secondary" disabled={saving} type="submit">{saving ? "Saving…" : "Save platform"}</button>{error ? <p className="form-error">{error}</p> : null}{success ? <p className="form-success">{success}</p> : null}</div></form>;
}

export function IntegrationAccountCreateForm({ platformId, countries }: { platformId: string; countries: Country[] }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; setError(""); setSaving(true);
    try {
      const values = Object.fromEntries(new FormData(element));
      await saveSourceSettings(`/api/v1/admin/source-platforms/${platformId}/accounts`, "POST", { ...values, isActive: false });
      element.reset(); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save settings."); }
    finally { setSaving(false); }
  }
  return <form className="account-create-form" onSubmit={submit}><h4>Add credential reference</h4><div className="account-form-grid"><label>Account key<input name="accountKey" placeholder="primary" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label><label>Label<input name="displayName" placeholder="Primary buyer account" /></label><label>Country<select name="countryCode" required><option value="">Choose</option>{countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name}</option>)}</select></label><label>Secret reference<input autoComplete="off" name="secretReference" placeholder="secret://crossly/sourcing/account" required /></label><label>Requests/minute<input name="rateLimitPerMinute" type="number" min="1" /></label><label>Daily quota<input name="dailyQuota" type="number" min="1" /></label><label>Credential expires<input name="credentialExpiresAt" type="datetime-local" /></label></div>{error ? <p className="form-error">{error}</p> : null}<button className="button secondary" disabled={saving} type="submit">{saving ? "Saving…" : "Save inactive account"}</button></form>;
}

export function IntegrationAccountSettingsForm({ account }: { account: Account }) {
  const router = useRouter(); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; setError(""); setSuccess(""); setSaving(true);
    try {
      const form = new FormData(element);
      const payload: Record<string, FormDataEntryValue | null | boolean> = { displayName: form.get("displayName"), rateLimitPerMinute: form.get("rateLimitPerMinute"), dailyQuota: form.get("dailyQuota"), credentialExpiresAt: form.get("credentialExpiresAt"), isActive: false };
      const secretReference = form.get("secretReference"); if (secretReference) payload.secretReference = secretReference;
      await saveSourceSettings(`/api/v1/admin/integration-accounts/${account.id}`, "PATCH", payload);
      setSuccess("Saved"); (element.elements.namedItem("secretReference") as HTMLInputElement).value = ""; router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save settings."); }
    finally { setSaving(false); }
  }
  return <form className="account-settings-form" onSubmit={submit}><div><b>{account.displayName ?? account.accountKey}</b><span>{account.countryCode} · {account.dailyQuotaUsed.toLocaleString()} used{account.dailyQuota ? ` / ${account.dailyQuota.toLocaleString()}` : ""}</span><small>{account.lastHealthStatus ?? "Never health checked"}{account.credentialExpiresAt ? ` · expires ${new Date(account.credentialExpiresAt).toLocaleDateString()}` : ""}</small></div><div className="account-settings-fields"><input aria-label="Account label" name="displayName" defaultValue={account.displayName ?? ""} placeholder="Account label" /><input aria-label="New secret reference" autoComplete="off" name="secretReference" placeholder={account.secretReferenceConfigured ? "Leave blank to keep secret reference" : "secret://…"} /><input aria-label="Requests per minute" name="rateLimitPerMinute" type="number" min="1" defaultValue={account.rateLimitPerMinute ?? ""} placeholder="RPM" /><input aria-label="Daily quota" name="dailyQuota" type="number" min="1" defaultValue={account.dailyQuota ?? ""} placeholder="Daily quota" /><input aria-label="Credential expiry" name="credentialExpiresAt" type="datetime-local" defaultValue={account.credentialExpiresAt?.slice(0, 16) ?? ""} /></div><div className="integration-save-row"><button className="button secondary" disabled={saving} type="submit">{saving ? "Saving…" : "Update account"}</button><em className={account.isHealthy ? "status-active" : "status-inactive"}>{account.isHealthy ? "Healthy" : "Not verified"}</em>{error ? <p className="form-error">{error}</p> : null}{success ? <p className="form-success">{success}</p> : null}</div></form>;
}
