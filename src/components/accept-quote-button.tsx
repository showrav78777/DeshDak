"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptQuoteButton({ requestId }: { requestId: string }) { const router = useRouter(); const [error, setError] = useState(""); const [loading, setLoading] = useState(false); async function accept() { setError(""); setLoading(true); const response = await fetch(`/api/v1/sourcing/requests/${requestId}/accept-quote`, { method: "POST" }); const result = await response.json(); setLoading(false); if (!response.ok) return setError(result.error?.message ?? "Unable to accept quote."); router.refresh(); } return <div><button className="button primary" onClick={accept} disabled={loading} type="button">{loading ? "Accepting…" : "Accept quote"}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>; }
