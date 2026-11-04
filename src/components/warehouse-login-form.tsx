"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { HumanVerification } from "@/components/human-verification";

export function WarehouseLoginForm() {
  const router = useRouter(); const [error, setError] = useState(""); const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form), portal: "warehouse" }) });
    const result = await response.json(); setIsSubmitting(false);
    if (!response.ok) return setError(result.error?.message ?? "Unable to sign in.");
    router.replace("/warehouse"); router.refresh();
  }
  return <form className="seller-login-card warehouse-login-card" onSubmit={submit}><p className="eyebrow">WAREHOUSE WORKER ACCESS</p><h2>Sign in to your station</h2><p className="form-help">Only assigned warehouses and minimum operational information will be available.</p><label htmlFor="warehouseEmail">Work account email</label><input id="warehouseEmail" name="email" type="email" autoComplete="email" required /><label htmlFor="warehousePassword">Password</label><input id="warehousePassword" name="password" type="password" autoComplete="current-password" required /><HumanVerification action="login" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Signing in…" : "Open Warehouse Portal"}</button></form>;
}
