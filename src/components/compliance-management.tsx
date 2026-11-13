"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useClientReady } from "@/components/use-client-ready";

function lines(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

export function ComplianceRuleCreateForm({ countries }: { countries: Array<{ isoCode: string; name: string }> }) {
  const router = useRouter(), ready = useClientReady(), inFlight = useRef(false);
  const [saving, setSaving] = useState(false), [refreshing, startRefresh] = useTransition(), [error, setError] = useState("");
  const busy = saving || refreshing;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || inFlight.current) return;
    const element = event.currentTarget, form = new FormData(element);
    inFlight.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/v1/admin/compliance/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruleCode: form.get("ruleCode"), name: form.get("name"), internalDescription: form.get("internalDescription"), customerMessage: form.get("customerMessage"), action: form.get("action"), keywords: lines(form.get("keywords")), hsCodePrefixes: lines(form.get("hsCodePrefixes")), originCountryCode: form.get("originCountryCode"), destinationCountryCode: form.get("destinationCountryCode"), effectiveFrom: form.get("effectiveFrom"), effectiveTo: form.get("effectiveTo"), legalReference: form.get("legalReference") }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to create this compliance rule."); return; }
      if (typeof result?.data?.rule?.id !== "string" || !result.data.rule.id || result.data.rule.ruleCode !== String(form.get("ruleCode")).trim().toUpperCase() || result.data.rule.status !== "DRAFT") throw new Error("Invalid created rule response");
      element.reset(); startRefresh(() => router.refresh());
    } catch { setError("The new rule could not be confirmed. Refresh the rules and check its code before retrying."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <form className="compliance-form" onSubmit={submit} aria-busy={busy}><label>Rule code<input disabled={!ready || busy} name="ruleCode" placeholder="BD-IMPORT-001" required /></label><label>Rule name<input disabled={!ready || busy} name="name" placeholder="Controlled product category" required /></label><label>Action<select disabled={!ready || busy} name="action"><option value="BLOCK">Block immediately</option><option value="MANUAL_REVIEW">Require manual review</option></select></label><label>Origin scope<select disabled={!ready || busy} name="originCountryCode"><option value="">Any origin</option>{countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name}</option>)}</select></label><label>Destination scope<select disabled={!ready || busy} name="destinationCountryCode"><option value="">Any destination</option>{countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name}</option>)}</select></label><label className="wide">Keywords or phrases <span>(one per line)</span><textarea disabled={!ready || busy} name="keywords" placeholder="Exact product phrase" /></label><label className="wide">HS-code prefixes <span>(one per line, digits only)</span><textarea disabled={!ready || busy} name="hsCodePrefixes" placeholder="1234" /></label><label className="wide">Customer-safe message<textarea disabled={!ready || busy} name="customerMessage" required defaultValue="This product cannot continue under the current destination rules. Please contact support if you need clarification." /></label><label className="wide">Internal description<textarea disabled={!ready || busy} name="internalDescription" /></label><label>Effective from <span>(optional)</span><input disabled={!ready || busy} name="effectiveFrom" type="datetime-local" /></label><label>Effective to <span>(optional)</span><input disabled={!ready || busy} name="effectiveTo" type="datetime-local" /></label><label className="wide">Legal reference <span>(internal)</span><input disabled={!ready || busy} name="legalReference" /></label>{error ? <p className="form-error wide" role="alert">{error}</p> : null}<button className="button primary wide" disabled={!ready || busy} type="submit">{busy ? "Creating…" : "Create draft rule"}</button></form>;
}

export function ComplianceRuleStatusControl({ ruleId, status, version }: { ruleId: string; status: string; version: number }) {
  const router = useRouter(), ready = useClientReady(), inFlight = useRef(false);
  const [saving, setSaving] = useState(false), [refreshing, startRefresh] = useTransition(), [error, setError] = useState("");
  const busy = saving || refreshing;
  async function change(nextStatus: "ACTIVE" | "PAUSED" | "ARCHIVED") {
    if (!ready || busy || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/compliance/rules/${ruleId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus, version }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to update this rule."); return; }
      const allowed = nextStatus === "ACTIVE" ? ["ACTIVE", "SCHEDULED"] : [nextStatus];
      if (result?.data?.rule?.id !== ruleId || result.data.rule.version !== version + 1 || !allowed.includes(result.data.rule.status)) throw new Error("Invalid rule status response");
      startRefresh(() => router.refresh());
    } catch { setError("The rule change could not be confirmed. Refresh the current rule before retrying."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  if (status === "ARCHIVED") return null;
  const enabled = status === "ACTIVE" || status === "SCHEDULED";
  return <div className="compliance-actions" aria-busy={busy}><button disabled={!ready || busy} onClick={() => change(enabled ? "PAUSED" : "ACTIVE")} type="button">{enabled ? "Pause" : "Activate or schedule"}</button><button disabled={!ready || busy} onClick={() => change("ARCHIVED")} type="button">Archive</button>{error ? <small className="form-error" role="alert">{error}</small> : null}</div>;
}

export function ComplianceDecisionForm({ screeningId, version, endpointPrefix = "/api/v1/admin/compliance/screenings" }: { screeningId: string; version: number; endpointPrefix?: string }) {
  const router = useRouter(), ready = useClientReady(), inFlight = useRef(false);
  const [saving, setSaving] = useState(false), [refreshing, startRefresh] = useTransition(), [error, setError] = useState("");
  const busy = saving || refreshing;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || inFlight.current) return;
    const form = new FormData(event.currentTarget), decision = form.get("decision");
    inFlight.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`${endpointPrefix}/${screeningId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note: form.get("note"), version }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to record this decision. Refresh the queue before retrying."); return; }
      if (result?.data?.screening?.id !== screeningId || result.data.screening.outcome !== decision) throw new Error("Invalid screening response");
      startRefresh(() => router.refresh());
    } catch { setError("Could not confirm this decision. Refresh the queue and review the case before retrying."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <form className="compliance-decision" onSubmit={submit} aria-busy={busy}><select aria-label="Decision" name="decision" disabled={!ready || busy}><option value="APPROVED">Approve exact retry</option><option value="REJECTED">Reject</option></select><textarea aria-label="Review note" name="note" placeholder="Document the evidence and reason" required disabled={!ready || busy} /><button disabled={!ready || busy} type="submit">{busy ? "Saving…" : "Record decision"}</button>{error ? <small className="form-error" role="alert">{error}</small> : null}</form>;
}

export function IdentityVerificationDecisionForm({ verificationId, version }: { verificationId: string; version: number }) {
  const router = useRouter();
  const ready = useClientReady(), inFlight = useRef(false);
  const [saving, setSaving] = useState(false), [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const busy = saving || refreshing;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || inFlight.current || busy) return;
    const form = new FormData(event.currentTarget), decision = form.get("decision");
    inFlight.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/compliance/identity-verifications/${verificationId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note: form.get("note"), version }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to record this identity decision. Refresh the queue before retrying."); return; }
      if (result?.data?.verification?.id !== verificationId || result.data.verification.status !== decision) throw new Error("Invalid identity decision response");
      startRefresh(() => router.refresh());
    } catch { setError("The identity decision could not be confirmed. Refresh the queue before retrying."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <form className="compliance-decision" onSubmit={submit} aria-busy={busy}><select aria-label="Identity decision" name="decision" disabled={!ready || busy}><option value="VERIFIED">Verify identity</option><option value="REJECTED">Reject and request resubmission</option></select><textarea aria-label="Review note" name="note" placeholder="Record the approved evidence and reason. Never enter a full document number." required disabled={!ready || busy} /><button disabled={!ready || busy} type="submit">{busy ? "Saving…" : "Record identity decision"}</button>{error ? <small className="form-error" role="alert">{error}</small> : null}</form>;
}

export function ComplianceCatalogMaintenanceControl({ lastStatus, lastFinishedAt }: { lastStatus?: string | null; lastFinishedAt?: string | null }) {
  const router = useRouter(); const [running, setRunning] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function run() {
    if (!window.confirm("Rescreen every active product and pause rules whose effective window has ended?")) return;
    setRunning(true); setError(""); setMessage("");
    const response = await fetch("/api/v1/admin/compliance/rescreen", { method: "POST", headers: { "Content-Type": "application/json" } });
    const result = await response.json(); setRunning(false);
    if (!response.ok) return setError(result.error?.message ?? "Unable to run catalog compliance maintenance.");
    setMessage(result.data.skipped ? "A catalog rescreen is already running." : `Catalog rescreen complete: ${result.data.summary.publicCatalog.clear} clear, ${result.data.summary.publicCatalog.blocked} blocked, ${result.data.summary.publicCatalog.reviewRequired} awaiting review.`); router.refresh();
  }
  return <section className="country-list-card"><p className="eyebrow">CATALOG MAINTENANCE</p><h2>Apply current effective rules</h2><p>The production scheduler should run this regularly. It activates due scheduled rules, pauses expired rules, and atomically recalculates public product visibility.</p><p><b>{lastStatus ?? "NOT RUN"}</b>{lastFinishedAt ? ` · ${lastFinishedAt}` : " · No completed run"}</p><button className="button secondary" disabled={running} onClick={run} type="button">{running ? "Rescreening…" : "Run catalog rescreen now"}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}</section>;
}
