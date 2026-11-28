"use client";

import { useRef, useState } from "react";

const states: Record<string, string> = {
  BUSY: "The processor is busy. Check status before trying again.",
  QUEUED: "Video received and waiting for processing.",
  PROCESSING: "Video processing is underway.",
  STORED: "Video stored privately.",
  REVIEW_REQUIRED: "Video requires staff review.",
  CANCELLED: "Video processing was cancelled.",
};

export function PrivateInspectionVideoUpload({ packageId, disabled }: { packageId: string; disabled: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef(false);

  async function request(action: "upload" | "status" | "process") {
    const upload = action === "upload";
    const processUpload = action === "process";
    if (pending.current || !key || (upload && (!file || confirmed))) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/operations/packages/${encodeURIComponent(packageId)}/inspection-video`, {
        method: action !== "status" ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(processUpload ? 180_000 : upload ? 60_000 : 10_000),
        headers: upload ? { "Content-Type": "video/mp4", "Idempotency-Key": key } : processUpload ? { "Idempotency-Key": key, "X-Video-Action": "process" } : { "X-Upload-Request-Key": key },
        body: upload ? file : undefined,
      });
      const result = await response.json();
      const state = result?.data?.state;
      if (!response.ok || typeof state !== "string" || !Object.hasOwn(states, state)) {
        setMessage(result?.error?.message ?? "Status could not be confirmed. Keep the request key and check again.");
        return;
      }
      setConfirmed(true);
      setMessage(states[state]);
    } catch {
      setMessage("Confirmation unavailable. Check status with the same request key before retrying.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <fieldset className="evidence-capture-controls" disabled={disabled || busy} aria-busy={busy}>
    <legend>Private inspection video</legend>
    <label>Capture or choose an MP4 up to 30 MiB
      <input type="file" accept="video/mp4" capture="environment" onChange={event => {
        const chosen = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!chosen) return;
        if (chosen.type !== "video/mp4" || chosen.size < 16 || chosen.size > 30 * 1024 * 1024) {
          setMessage("Choose an MP4 file up to 30 MiB.");
          return;
        }
        setFile(chosen);
        setKey(crypto.randomUUID());
        setConfirmed(false);
        setMessage("");
      }} />
    </label>
    {file && <p>Selected file: {file.name}</p>}
    <label>Upload request key
      <input value={key} readOnly={Boolean(file)} onChange={event => { setKey(event.target.value.trim()); setConfirmed(false); setMessage(""); }} />
    </label>
    <p>Keep the request key to check this upload after reloading. Video is staged separately from the inspection decision.</p>
    <button type="button" disabled={!file || confirmed} onClick={() => void request("upload")}>Upload video</button>
    <button type="button" disabled={!/^[A-Za-z0-9:_-]{16,128}$/.test(key)} onClick={() => void request("status")}>Check video status</button>
    <button type="button" disabled={!confirmed} onClick={() => void request("process")}>Process video</button>
    <p role="status">{busy ? "Contacting the video service…" : message}</p>
  </fieldset>;
}
