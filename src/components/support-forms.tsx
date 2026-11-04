"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { HumanVerification } from "@/components/human-verification";
import { useClientReady } from "@/components/use-client-ready";

export function SupportLoginForm() {
  const ready = useClientReady();
  const pending = useRef(false);
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form), portal: "support" }) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to sign in."); return; }
      const data = result?.data;
      if (data?.nextAction !== "SIGNED_IN" || !Array.isArray(data.user?.roles) || !data.user.roles.includes("customer_service") || typeof data.session?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.session.id)) throw new Error("Unconfirmed support session");
      const password = formElement.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      router.replace("/support/tickets"); router.refresh();
    } catch { setError("Could not confirm sign-in. Reload to check your session before trying again."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form className="seller-login-card support-login-card" method="post" aria-busy={saving} onSubmit={submit}><p className="eyebrow">CUSTOMER SERVICE ACCESS</p><h2>Sign in to your assigned queue</h2><p className="form-help">Customer information is shown only after a ticket is assigned to you. Every action is audited.</p>{!ready ? <p>Enable JavaScript to sign in. No credentials have been submitted.</p> : null}<label htmlFor="supportEmail">Work account email</label><input disabled={!ready || saving} id="supportEmail" name="email" type="email" autoComplete="email" required /><label htmlFor="supportPassword">Password</label><input disabled={!ready || saving} id="supportPassword" name="password" type="password" autoComplete="current-password" required /><HumanVerification action="login" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Signing in…" : "Open Support Portal"}</button></form>;
}

export function SupportLogoutButton() {
  const ready = useClientReady();
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function logout() {
    if (!ready || pending.current) return;
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok || result?.data?.loggedOut !== true) throw new Error("Unconfirmed logout");
      window.location.replace("/");
    } catch { setError("Could not confirm sign-out. Reload to check your session before trying again."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <><button className="support-logout" disabled={!ready || saving} onClick={logout} type="button">{saving ? "Signing out…" : "Sign out"}</button>{error ? <small className="form-error" role="alert">{error}</small> : null}</>;
}

type LinkOption = { id: string; label: string };
type SupportAgentProfileValue = { availability: string; acceptingNewTickets: boolean; maxActiveTickets: number; languages: string[]; statusNote: string | null; version: number } | null;
type SupportQualityReviewValue = { score: number; outcome: string; summary: string; coachingAction: string | null; version: number } | null;

export function TicketCreateForm({ orders, rmas }: { orders: LinkOption[]; rmas: LinkOption[] }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending.current) return;
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ category: form.get("category"), subject: form.get("subject"), body: form.get("body"), ...(form.get("orderId") ? { orderId: form.get("orderId") } : {}), ...(form.get("rmaId") ? { rmaId: form.get("rmaId") } : {}), attachmentReferences: [] });
    pending.current = true; setSaving(true); setError("");
    try {
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      const response = await fetch("/api/v1/tickets", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result?.error?.message === "string" ? result.error.message : "Could not create the support request.");
        return;
      }
      const id = result?.data?.ticket?.id;
      if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Unconfirmed ticket response");
      router.push(`/support/${id}`); router.refresh();
    } catch {
      setError("Could not confirm submission. Check Your requests before retrying. Your entered details are kept.");
    } finally { pending.current = false; setSaving(false); }
  }
  const disabled = !ready || saving;
  return <form className="support-create-form" method="post" aria-busy={saving} onSubmit={submit}>
    {!ready ? <p>Enable JavaScript to open a support request. No request has been submitted.</p> : null}
    <div className="support-fields">
      <label>What do you need help with?<select disabled={disabled} name="category" defaultValue="GENERAL"><option value="ORDER">Order</option><option value="PAYMENT">Payment</option><option value="SHIPPING">Shipping or tracking</option><option value="RETURN_REFUND">Return or refund</option><option value="SOURCING">Product sourcing</option><option value="ACCOUNT">Account</option><option value="TECHNICAL">Website problem</option><option value="GENERAL">General question</option></select></label>
      <label>Subject<input disabled={disabled} name="subject" minLength={5} maxLength={160} placeholder="A short description of the problem" required /></label>
      <label>Related order <span>(optional)</span><select disabled={disabled} name="orderId" defaultValue=""><option value="">No order selected</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.label}</option>)}</select></label>
      <label>Related claim <span>(optional)</span><select disabled={disabled} name="rmaId" defaultValue=""><option value="">No claim selected</option>{rmas.map((rma) => <option key={rma.id} value={rma.id}>{rma.label}</option>)}</select></label>
      <label className="wide">Tell us what happened<textarea disabled={disabled} name="body" minLength={10} maxLength={5000} placeholder="Include the exact problem, when it happened, and what help you need." required /></label>
    </div>
    <p className="form-help">Private image/file upload will be enabled after secure storage and malware scanning are connected. Do not paste passwords, OTP codes, card details, or identity documents.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button primary" disabled={disabled} type="submit">{saving ? "Submitting…" : "Open support request"}</button>
  </form>;
}

export function TicketMessageForm({ ticketId, allowInternalNote = false }: { ticketId: string; allowInternalNote?: boolean }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current) return;
    pending.current = true; setSaving(true); setError(""); setSaved(false); const formElement = event.currentTarget; const form = new FormData(formElement);
    const payload = JSON.stringify({ body: form.get("body"), attachmentReferences: [], internalNote: allowInternalNote && form.get("internalNote") === "on" });
    try {
      if (!retry.current || retry.current.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
      const response = await fetch(`/api/v1/tickets/${ticketId}/messages`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": retry.current.key }, body: payload });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Could not send the message."); return; }
      const message = result?.data?.message;
      if (typeof message?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.id) || typeof message.createdAt !== "string" || !Number.isFinite(Date.parse(message.createdAt))) throw new Error("Unconfirmed message response");
      retry.current = null; formElement.reset(); setSaved(true); router.refresh();
    } catch { setError("Could not confirm this message. Check the conversation before retrying. Your text is kept."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form className="ticket-message-form" method="post" aria-busy={saving} onSubmit={submit}>{!ready ? <p>Enable JavaScript to send a message. No message has been submitted.</p> : null}<label htmlFor={`message-${ticketId}`}>{allowInternalNote ? "Reply or internal note" : "Your reply"}</label><textarea disabled={!ready || saving} id={`message-${ticketId}`} name="body" maxLength={5000} required />{allowInternalNote ? <label className="internal-note-check"><input disabled={!ready || saving} name="internalNote" type="checkbox" /> Keep this as an internal staff note</label> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{saved ? <p className="form-success" role="status">Message saved.</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Sending…" : "Send message"}</button></form>;
}

export function SupportSatisfactionForm({ ticketId }: { ticketId: string }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [score, setScore] = useState(5);
  const [issueResolved, setIssueResolved] = useState(true);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending.current || submitted) return;
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ score, issueResolved, comment: form.get("comment") });
    pending.current = true; setSaving(true);
    setError("");
    try {
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      const response = await fetch(`/api/v1/tickets/${ticketId}/satisfaction`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Could not submit your feedback."); return; }
      const rating = result?.data?.rating;
      if (typeof rating?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rating.id) || rating.score !== score || rating.issueResolved !== issueResolved || rating.comment !== (String(form.get("comment") ?? "").trim() || null)) throw new Error("Unconfirmed feedback");
      setSubmitted(true); router.refresh();
    } catch { setError("Could not confirm your feedback. Reload and check for submitted feedback before retrying. Your answers are kept."); }
    finally { pending.current = false; setSaving(false); }
  }

  if (submitted) return <p className="form-success" role="status">Feedback saved. Refreshing your support request…</p>;
  return <form className="support-satisfaction-form" method="post" aria-busy={saving} onSubmit={submit}>
    {!ready ? <p>Enable JavaScript to submit feedback. No feedback has been submitted.</p> : null}
    <div><p className="eyebrow">PRIVATE CUSTOMER FEEDBACK</p><h2>How was this resolution?</h2><p>Your response is recorded once and cannot be edited. It is visible only to authorized support leadership and the assigned agent.</p></div>
    <fieldset disabled={!ready || saving}><legend>Support rating</legend><div className="support-rating-options">{[1, 2, 3, 4, 5].map((value) => <label className={score === value ? "selected" : ""} key={value}><input checked={score === value} name="score" onChange={() => setScore(value)} type="radio" value={value} /><span aria-hidden="true">★</span><small>{value}</small></label>)}</div></fieldset>
    <fieldset disabled={!ready || saving}><legend>Is your issue resolved?</legend><div className="support-resolution-options"><label><input checked={issueResolved} name="issueResolved" onChange={() => setIssueResolved(true)} type="radio" /> Yes</label><label><input checked={!issueResolved} name="issueResolved" onChange={() => setIssueResolved(false)} type="radio" /> No</label></div></fieldset>
    <label>Comment <span>{score <= 2 || !issueResolved ? "(required)" : "(optional)"}</span><textarea disabled={!ready || saving} name="comment" minLength={score <= 2 || !issueResolved ? 10 : undefined} maxLength={2000} placeholder="Tell us what worked or what still needs attention." required={score <= 2 || !issueResolved} /></label>
    <p className="form-help">Do not include passwords, OTP codes, card details, or identity documents.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Submitting…" : "Submit feedback"}</button>
  </form>;
}

export function TicketActionControls({ ticketId, status, priority, version, unassigned = false, agents = [], oversightOnly = false }: { ticketId: string; status: string; priority: string; version: number; unassigned?: boolean; agents?: LinkOption[]; oversightOnly?: boolean }) {
  const ready = useClientReady();
  const busy = useRef(false);
  const [confirmedVersion, setConfirmedVersion] = useState<number | null>(null);
  const [pending, setPending] = useState<{ action: string; extra: Record<string, unknown> } | null>(null);
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const disabled = !ready || saving || pending !== null || (confirmedVersion !== null && confirmedVersion > version);
  function act(action: string, extra: Record<string, unknown> = {}) { if (disabled || busy.current) return; setError(""); setConfirmedVersion(null); setPending({ action, extra }); }
  async function confirmAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || !pending || busy.current) return;
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    if (note.length < 3) { setError("Add a note with at least 3 characters."); return; }
    busy.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/support/tickets/${ticketId}/actions`, { method: "PATCH", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: pending.action, version, note, ...pending.extra }) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Could not update the ticket."); return; }
      const ticket = result?.data?.ticket;
      const expectedStatus = ({ WAITING_FOR_CUSTOMER: "WAITING_FOR_CUSTOMER", RESOLVE: "RESOLVED", REOPEN: "WAITING_FOR_SUPPORT", CLOSE: "CLOSED" } as Record<string, string>)[pending.action];
      if (ticket?.id !== ticketId || ticket.version !== version + 1 || (expectedStatus && ticket.status !== expectedStatus) || (pending.action === "SET_PRIORITY" && ticket.priority !== pending.extra.priority) || (pending.action === "ESCALATE" && ticket.priority !== "URGENT") || (pending.action === "ASSIGN" && ticket.assignedAgentId !== pending.extra.agentId) || (pending.action === "CLAIM" && !ticket.assignedAgentId)) throw new Error("Unconfirmed ticket update");
      setConfirmedVersion(ticket.version); setPending(null); router.refresh();
    } catch { setError("Could not confirm this update. Reload and check ticket history before retrying. Your note is kept."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <div className="ticket-action-controls" aria-busy={saving}>
    <p>Choose an action, enter a reason, then confirm. Updates are recorded in history.</p>
    {!ready ? <p>Enable JavaScript to update tickets. No update has been submitted.</p> : null}
    {pending ? <form method="post" className="ticket-action-confirm" onSubmit={confirmAction} key={pending.action}><h3>Confirm: {pending.action.toLowerCase().replaceAll("_", " ")}</h3><label htmlFor={`action-note-${ticketId}`}>Operational note<textarea autoFocus id={`action-note-${ticketId}`} name="note" minLength={3} maxLength={1000} required disabled={!ready || saving} placeholder="Explain the reason for this update" /></label><p>This note is saved in the ticket activity history.</p><div><button className="button primary" type="submit" disabled={!ready || saving}>{saving ? "Saving…" : "Confirm update"}</button><button className="button secondary" type="button" disabled={!ready || saving} onClick={() => { setPending(null); setError(""); }}>Cancel</button></div></form> : null}
    {unassigned ? <button className="button primary" disabled={disabled} onClick={() => act("CLAIM")} type="button">Claim ticket</button> : null}
    {!oversightOnly && !unassigned && !["RESOLVED", "CLOSED"].includes(status) ? <><button className="button secondary" disabled={disabled} onClick={() => act("WAITING_FOR_CUSTOMER")} type="button">Wait for customer</button><button className="button primary" disabled={disabled} onClick={() => act("RESOLVE")} type="button">Resolve</button></> : null}
    {!oversightOnly && status === "RESOLVED" ? <><button className="button secondary" disabled={disabled} onClick={() => act("REOPEN")} type="button">Reopen</button><button className="button primary" disabled={disabled} onClick={() => act("CLOSE")} type="button">Close</button></> : null}
    {!unassigned ? <label>Priority<select value={priority} disabled={disabled} onChange={(event) => void act("SET_PRIORITY", { priority: event.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label> : null}
    {status !== "CLOSED" ? <button className="button danger" disabled={disabled || priority === "URGENT"} onClick={() => act("ESCALATE")} type="button">Escalate</button> : null}
    {agents.length ? <label>Assign agent<select defaultValue="" disabled={disabled} onChange={(event) => { if (event.target.value) void act("ASSIGN", { agentId: event.target.value }); }}><option value="">Choose agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {confirmedVersion !== null ? <p className="form-success" role="status">Ticket update saved.</p> : null}
    {pending?.action === "SET_PRIORITY" ? <p>New priority: {String(pending.extra.priority)}</p> : null}
    {pending?.action === "ASSIGN" ? <p>New agent: {agents.find(agent => agent.id === pending.extra.agentId)?.label ?? "Selected agent"}</p> : null}
  </div>;
}

export function SupportAgentRoleForm() {
  const ready = useClientReady();
  const pending = useRef(false);
  const router = useRouter(); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current) return;
    const formElement = event.currentTarget;
    const email = String(new FormData(formElement).get("email") ?? "").trim().toLowerCase();
    if (!window.confirm(`Grant Customer Service access to ${email}? This allows work on assigned customer requests.`)) return;
    pending.current = true; setSaving(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/v1/admin/support-agents", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Could not grant access."); return; }
      const agent = result?.data?.agent;
      if (agent?.email !== email || typeof agent.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agent.id) || typeof agent.fullName !== "string" || !agent.fullName.trim()) throw new Error("Unconfirmed role grant");
      setSuccess(`Customer Service access granted to ${agent.fullName}.`); formElement.reset(); router.refresh();
    } catch { setError("Could not confirm the access change. Reload and check workforce access before retrying. The entered email is kept."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form className="support-agent-form" method="post" aria-busy={saving} onSubmit={submit}>{!ready ? <p>Enable JavaScript to grant access. No access change has been submitted.</p> : null}<label>Existing verified account email<input disabled={!ready || saving} name="email" type="email" required placeholder="agent@company.com" /></label><p className="form-help">The person must first register and verify an account. Confirm the email before granting support access; their password is not changed.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}{success ? <p className="form-success" role="status">{success}</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Granting…" : "Grant Customer Service role"}</button></form>;
}

export function SupportAgentRevokeButton({ agentId, activeTickets }: { agentId: string; activeTickets: number }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function revoke() {
    if (!ready || pending.current || confirmed || activeTickets || !window.confirm("Remove Customer Service access and sign this person out of every support session?")) return;
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/support-agents/${agentId}`, { method: "DELETE", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Could not remove access."); return; }
      if (result?.data?.agent?.id !== agentId || !Number.isInteger(result.data.revokedSessions) || result.data.revokedSessions < 0) throw new Error("Unconfirmed removal");
      setConfirmed(true); router.refresh();
    } catch { setError("Could not confirm removal. Reload and check access before retrying."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <span className="support-agent-revoke" aria-busy={saving}><button disabled={!ready || saving || confirmed || activeTickets > 0} onClick={revoke} title={!ready ? "Enable JavaScript to remove access" : activeTickets ? "Reassign active tickets first" : "Remove Customer Service access"} type="button">{saving ? "Removing…" : confirmed ? "Access removed" : "Remove"}</button>{error ? <small role="alert">{error}</small> : null}</span>;
}

export function SupportAgentProfileForm({ agentId, profile }: { agentId: string; profile: SupportAgentProfileValue }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const [confirmedVersion, setConfirmedVersion] = useState(0);
  const router = useRouter(); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [saving, setSaving] = useState(false);
  const disabled = !ready || saving || confirmedVersion > (profile?.version ?? 0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || pending.current) return;
    const form = new FormData(event.currentTarget);
    const input = { availability: form.get("availability"), acceptingNewTickets: form.get("acceptingNewTickets") === "on", maxActiveTickets: Number(form.get("maxActiveTickets")), languages: [...new Set(String(form.get("languages") ?? "").split(",").map(value => value.trim()).filter(Boolean))], statusNote: String(form.get("statusNote") ?? "").trim() || null, ...(profile ? { version: profile.version } : {}) };
    pending.current = true; setSaving(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/v1/admin/support-agents/${agentId}/profile`, { method: "PUT", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Could not update workforce settings."); return; }
      const saved = result?.data?.profile;
      if (result?.data?.agent?.id !== agentId || saved?.version !== (profile?.version ?? 0) + 1 || saved.availability !== input.availability || saved.acceptingNewTickets !== input.acceptingNewTickets || saved.maxActiveTickets !== input.maxActiveTickets || JSON.stringify(saved.languages) !== JSON.stringify(input.languages) || saved.statusNote !== (String(input.statusNote ?? "").trim() || null)) throw new Error("Unconfirmed workforce settings");
      setConfirmedVersion(saved.version); setSuccess("Workforce settings saved."); router.refresh();
    } catch { setError("Could not confirm workforce settings. Reload and review saved settings before retrying. Your entries are kept."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <details inert={!ready} className="support-agent-profile"><summary>Availability & capacity</summary><form method="post" aria-busy={saving} onSubmit={submit}><p>Set availability and capacity before assigning work. Existing tickets remain assigned.</p>{!ready ? <p>Enable JavaScript to save settings. No change has been submitted.</p> : null}<label>Status<select disabled={disabled} name="availability" defaultValue={profile?.availability ?? "AVAILABLE"}><option value="AVAILABLE">Available</option><option value="BUSY">Busy</option><option value="OFFLINE">Offline</option></select></label><label className="support-check"><input disabled={disabled} name="acceptingNewTickets" type="checkbox" defaultChecked={profile?.acceptingNewTickets ?? true} /> Accept new assignments</label><label>Maximum active tickets<input disabled={disabled} name="maxActiveTickets" type="number" min="1" max="100" defaultValue={profile?.maxActiveTickets ?? 20} required /></label><label>Languages<input disabled={disabled} name="languages" defaultValue={(profile?.languages ?? ["bn", "en"]).join(", ")} placeholder="bn, en" required /></label><label>Status note<input disabled={disabled} name="statusNote" defaultValue={profile?.statusNote ?? ""} maxLength={240} placeholder="Optional rota or handover note" /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}{success ? <p className="form-success" role="status">{success}</p> : null}<button className="button secondary" disabled={disabled} type="submit">{saving ? "Saving…" : "Save workforce settings"}</button></form></details>;
}

export function SupportQualityReviewForm({ ticketId, review }: { ticketId: string; review: SupportQualityReviewValue }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const [confirmedVersion, setConfirmedVersion] = useState(0);
  const [outcome, setOutcome] = useState(review?.outcome ?? "PASS");
  const router = useRouter(); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [saving, setSaving] = useState(false);
  const disabled = !ready || saving || confirmedVersion > (review?.version ?? 0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || pending.current) return;
    const form = new FormData(event.currentTarget);
    const input = { score: Number(form.get("score")), outcome: form.get("outcome"), summary: String(form.get("summary") ?? "").trim(), coachingAction: String(form.get("coachingAction") ?? "").trim() || null, ...(review ? { version: review.version } : {}) };
    pending.current = true; setSaving(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/v1/admin/support-quality-reviews/${ticketId}`, { method: "PUT", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Could not save the quality review."); return; }
      const saved = result?.data?.review;
      if (saved?.ticketId !== ticketId || saved.version !== (review?.version ?? 0) + 1 || saved.score !== input.score || saved.outcome !== input.outcome || saved.summary !== input.summary || saved.coachingAction !== input.coachingAction) throw new Error("Unconfirmed quality review");
      setConfirmedVersion(saved.version); setSuccess("Quality review saved."); router.refresh();
    } catch { setError("Could not confirm the quality review. Reload and review saved details before retrying. Your entries are kept."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form className="support-quality-form" method="post" aria-busy={saving} onSubmit={submit}><p>Review the resolved conversation, choose an outcome, and record any required follow-up.</p>{!ready ? <p>Enable JavaScript to save the review. No review has been submitted.</p> : null}<label>Quality score<select disabled={disabled} name="score" defaultValue={String(review?.score ?? 5)}><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Acceptable</option><option value="2">2 · Needs improvement</option><option value="1">1 · Critical</option></select></label><label>Outcome<select disabled={disabled} name="outcome" value={outcome} onChange={event => setOutcome(event.target.value)}><option value="PASS">Pass</option><option value="COACHING_REQUIRED">Coaching required</option><option value="ESCALATED">Escalated</option></select></label><label>Review summary<textarea disabled={disabled} name="summary" minLength={10} maxLength={2000} defaultValue={review?.summary ?? ""} required /></label><label>Coaching or escalation action <span>{outcome !== "PASS" ? "(required)" : "(optional)"}</span><textarea disabled={disabled} name="coachingAction" maxLength={2000} required={outcome !== "PASS"} defaultValue={review?.coachingAction ?? ""} placeholder="Required when the outcome is not Pass" /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}{success ? <p className="form-success" role="status">{success}</p> : null}<button className="button primary" disabled={disabled} type="submit">{saving ? "Saving…" : review ? "Update quality review" : "Record quality review"}</button></form>;
}
