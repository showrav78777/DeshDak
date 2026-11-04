"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useClientReady } from "@/components/use-client-ready";

const uncertain = "Could not confirm the change. Reload the calendar to check before trying again.";
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const entity = (value: unknown) => record(value) && typeof value.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id);
async function save(path: string, method: string, body: unknown, confirmed: (data: Record<string, unknown>) => boolean) {
  const response = await fetch(path, { method, credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok && record(result) && record(result.error) && typeof result.error.message === "string") throw new Error(result.error.message);
  if (!response.ok || !record(result) || !record(result.data) || !confirmed(result.data)) throw new Error(uncertain);
}
function useCalendarMutation() {
  const ready = useClientReady(); const pending = useRef(false); const router = useRouter();
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  async function run(action: () => Promise<void>, message: string) {
    if (!ready || pending.current) return;
    pending.current = true; setSaving(true); setError(""); setSuccess("");
    try { await action(); setSuccess(message); router.refresh(); }
    catch (error) { setError(error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) ? uncertain : error instanceof Error ? error.message : uncertain); }
    finally { pending.current = false; setSaving(false); }
  }
  return { ready, saving, error, success, run, disabled: !ready || saving };
}
function CalendarStatus({ state }: { state: ReturnType<typeof useCalendarMutation> }) {
  return <>{!state.ready ? <p className="form-help">Enable JavaScript to change the calendar. No change has been submitted.</p> : null}{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}{state.success ? <p className="form-success" role="status">{state.success}</p> : null}</>;
}
function minuteValue(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function timeValue(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }

type Policy = { timeZone: string; firstResponseBusinessDays: number; approachingHours: number; businessWeekdays: number[]; openingMinute: number; closingMinute: number; requireScheduledShift: boolean; version: number };
type Option = { id: string; label: string };

export function SupportPolicyForm({ policy }: { policy: Policy }) {
  const state = useCalendarMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await state.run(async () => { await save("/api/v1/admin/support-policy", "PUT", { timeZone: form.get("timeZone"), firstResponseBusinessDays: Number(form.get("firstResponseBusinessDays")), approachingHours: Number(form.get("approachingHours")), businessWeekdays: form.getAll("businessWeekdays").map(Number), openingMinute: minuteValue(String(form.get("openingTime"))), closingMinute: minuteValue(String(form.get("closingTime"))), requireScheduledShift: form.get("requireScheduledShift") === "on", version: policy.version }, data => record(data.policy) && data.policy.id === "default" && typeof data.policy.version === "number" && data.policy.version >= policy.version); }, "Operating policy saved. New tickets will snapshot this calendar.");
  }
  const days = [[0, "Sun"], [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"]] as const;
  return <form className="support-policy-form" method="post" aria-busy={state.saving} onSubmit={submit}><fieldset disabled={state.disabled}><label>Timezone<input name="timeZone" defaultValue={policy.timeZone} required /></label><label>First-response business days<input name="firstResponseBusinessDays" type="number" min="1" max="10" defaultValue={policy.firstResponseBusinessDays} required /></label><label>Approaching alert hours<input name="approachingHours" type="number" min="1" max="168" defaultValue={policy.approachingHours} required /></label><div className="support-day-grid"><span>Business days</span>{days.map(([value, label]) => <label key={value}><input name="businessWeekdays" type="checkbox" value={value} defaultChecked={policy.businessWeekdays.includes(value)} /> {label}</label>)}</div><label>Opening time<input name="openingTime" type="time" defaultValue={timeValue(policy.openingMinute)} required /></label><label>Closing time<input name="closingTime" type="time" defaultValue={timeValue(policy.closingMinute)} required /></label><label className="support-check"><input name="requireScheduledShift" type="checkbox" defaultChecked={policy.requireScheduledShift} /> Assign only during a scheduled shift</label><p className="form-help">Opening and closing times use the policy timezone. Populate the rota before enabling shift-only assignment. Existing ticket deadlines remain unchanged.</p><CalendarStatus state={state} /><button className="button primary"  type="submit">{state.saving ? "Saving…" : "Save operating policy"}</button></fieldset></form>;
}

export function SupportHolidayForm() {
  const state = useCalendarMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const payload = Object.fromEntries(new FormData(formElement));
    await state.run(async () => { await save("/api/v1/admin/support-holidays", "POST", payload, data => entity(data.holiday)); formElement.reset(); }, "Closed date added.");
  }
  return <form className="support-holiday-form" method="post" aria-busy={state.saving} onSubmit={submit}><fieldset disabled={state.disabled}><label>Date<input name="date" type="date" required /></label><label>Name<input name="name" minLength={2} maxLength={120} required /></label><CalendarStatus state={state} /><button className="button secondary"  type="submit">{state.saving ? "Adding…" : "Add closed day"}</button></fieldset></form>;
}

export function SupportShiftForm({ agents }: { agents: Option[] }) {
  const state = useCalendarMutation();
  const zone = state.ready ? Intl.DateTimeFormat().resolvedOptions().timeZone : "your device timezone";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await state.run(async () => { const start = new Date(String(form.get("startsAt"))); const end = new Date(String(form.get("endsAt"))); if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("Choose an end time after the start time."); await save("/api/v1/admin/support-shifts", "POST", { agentId: form.get("agentId"), startsAt: start.toISOString(), endsAt: end.toISOString(), note: form.get("note") }, data => entity(data.shift) && record(data.shift) && data.shift.status === "SCHEDULED"); formElement.reset(); }, "Shift scheduled.");
  }
  return <form className="support-shift-form" method="post" aria-busy={state.saving} onSubmit={submit}><fieldset disabled={state.disabled}><p className="form-help">Shift entry times use {zone}. Saved times are displayed in the calendar timezone.</p>{!agents.length ? <p className="form-help">Grant Customer Service access from Support operations before scheduling a shift.</p> : null}<label>Agent<select name="agentId" required defaultValue=""><option value="" disabled>Choose agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label><label>Starts<input name="startsAt" type="datetime-local" required /></label><label>Ends<input name="endsAt" type="datetime-local" required /></label><label>Note<input name="note" maxLength={240} placeholder="Optional handover or coverage note" /></label><CalendarStatus state={state} /><button className="button secondary" disabled={!agents.length} type="submit">{state.saving ? "Scheduling…" : "Schedule shift"}</button></fieldset></form>;
}

export function SupportPolicyRemoveButton({ path, label }: { path: string; label: string }) {
  const state = useCalendarMutation();
  async function remove() {
    if (state.disabled || !window.confirm(`${label}?`)) return;
    await state.run(() => save(path, "DELETE", undefined, data => data.removed === true || (entity(data.shift) && record(data.shift) && data.shift.status === "CANCELLED")), "Calendar updated.");
  }
  return <span className="support-policy-remove"><button disabled={state.disabled} onClick={remove} type="button">{state.saving ? "Saving…" : label}</button><CalendarStatus state={state} /></span>;
}
