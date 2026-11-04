"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useClientReady } from "@/components/use-client-ready";

type DetectedBarcode = { rawValue: string };
type Detector = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

export function WarehouseScanner({ portal = "warehouse" }: { portal?: "warehouse" | "inspector" | "logistics" }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const isInspector = portal === "inspector";
  const isLogistics = portal === "logistics";
  const router = useRouter(); const videoRef = useRef<HTMLVideoElement>(null); const streamRef = useRef<MediaStream | null>(null); const timerRef = useRef<number | null>(null);
  const [error, setError] = useState(""); const [message, setMessage] = useState("Ready for a package, order, or inbound tracking code."); const [scanning, setScanning] = useState(false); const [working, setWorking] = useState(false);
  const [matchedTask, setMatchedTask] = useState("");

  function stopCamera() { if (timerRef.current) window.clearTimeout(timerRef.current); timerRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; if (videoRef.current) videoRef.current.srcObject = null; setScanning(false); }
  useEffect(() => stopCamera, []);

  async function resolve(code: string) {
    if (!ready || pending.current) return; pending.current = true; setWorking(true); setError(""); setMessage("Checking assigned warehouse tasks…");
    const endpoint = isInspector ? "/api/v1/operations/inspections/lookup" : isLogistics ? "/api/v1/operations/shipments/lookup" : "/api/v1/operations/packages/lookup";
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Code not found.");
      const destination = result?.data?.destination;
      if (typeof destination !== "string" || !destination.startsWith(`/${portal}/`) || destination.includes("\\")) throw new Error("The scan response was incomplete. Try again.");
      stopCamera(); setMatchedTask(destination); setMessage("Task found. Opening the matched task…");
      // push loads the destination; refreshing the old route can race navigation.
      router.push(destination);
    } catch (caught) {
      stopCamera(); setMessage("Ready to scan again.");
      setError(caught instanceof Error && !(caught instanceof TypeError) && caught.name !== "TimeoutError" && caught.name !== "SyntaxError" ? caught.message : "Could not check the code. Check your connection and try again.");
      setWorking(false);
    } finally { pending.current = false; }
  }

  async function startCamera() {
    setError("");
    const BarcodeDetectorApi = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia) return setError("Camera access is not supported in this browser. Use the code field below.");
    if (!BarcodeDetectorApi) return setError("Automatic QR/barcode detection is unavailable in this browser. Use a hardware scanner or enter the code below.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream; if (!videoRef.current) return stopCamera(); videoRef.current.srcObject = stream; await videoRef.current.play(); setScanning(true); setMessage("Point the camera at the QR or barcode.");
      const detector = new BarcodeDetectorApi({ formats: ["qr_code", "code_128"] });
      const tick = async () => { if (!videoRef.current || !streamRef.current) return; try { const results = await detector.detect(videoRef.current); if (results[0]?.rawValue) return void resolve(results[0].rawValue); } catch { setError("The camera could not read this code. Try again or enter it manually."); stopCamera(); return; } timerRef.current = window.setTimeout(tick, 350); };
      timerRef.current = window.setTimeout(tick, 350);
    } catch { setError("Camera permission was not available. Use a hardware scanner or enter the code below."); stopCamera(); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const code = String(new FormData(event.currentTarget).get("code") ?? ""); await resolve(code); }
  const roleLabel = isInspector ? "Inspector" : isLogistics ? "Logistics" : "Warehouse"; const codeLabel = isLogistics ? "Tracking, package, or order code" : "Package, order, or inbound tracking code";
  return <section className="warehouse-scanner-card">
    <div className={`warehouse-camera ${scanning ? "is-active" : ""}`}><video aria-label={`${roleLabel} barcode camera`} muted playsInline ref={videoRef} /><span aria-hidden="true">⌗</span></div>
    <p className="warehouse-scan-message" aria-live="polite">{message}</p>
    {matchedTask ? <a className="button secondary" href={matchedTask}>Open matched task</a> : null}
    <div className="warehouse-camera-actions"><button className="button primary" disabled={!ready || working || scanning} onClick={startCamera} type="button">{scanning ? "Camera active" : "Start camera scan"}</button>{scanning ? <button className="button secondary" onClick={stopCamera} type="button">Stop camera</button> : null}</div>
    <div className="warehouse-scan-divider"><span>or use hardware scanner / code</span></div>
    <form className="warehouse-manual-scan" method="post" onSubmit={submit}><label htmlFor={`${portal}ScanCode`}>{codeLabel}</label><div><input autoCapitalize="characters" autoComplete="off" autoFocus id={`${portal}ScanCode`} maxLength={500} name="code" placeholder="Scan or enter code" required /><button className="button primary" disabled={!ready || working} type="submit">{working ? "Checking…" : "Open task"}</button></div></form>
    {!ready ? <p className="form-error">Enable JavaScript to look up assigned tasks. No code has been submitted.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}
