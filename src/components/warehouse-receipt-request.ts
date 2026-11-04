"use client";

import { useRef } from "react";

/** Keep the same request identity after uncertain network results, until inputs change. */
export function useWarehouseReceiptRequest() {
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const pending = useRef(false);
  return async (form: HTMLFormElement) => {
    if (pending.current) throw new Error("Receipt is already being checked. Wait before trying again.");
    const payload = JSON.stringify(Object.fromEntries(new FormData(form)));
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: `warehouse-receipt:${crypto.randomUUID()}` };
    pending.current = true;
    try {
      let response;
      try {
        response = await fetch("/api/v1/operations/packages/receive", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current!.key }, body: payload });
      } catch { throw new Error("Receipt could not be confirmed; it may already have been saved. Refresh and review the package before retrying."); }
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message ?? "Receipt not confirmed. Refresh and review the order before retrying.");
      if (!result?.data?.package?.id || !result?.data?.package?.packageCode) throw new Error("Receipt response was incomplete. Refresh and review the package before retrying.");
      attempt.current = null;
      return result;
    } finally { pending.current = false; }
  };
}
