"use client";

import { useEffect, useState } from "react";

export type CheckoutPaymentMethod = { code: string; displayName: string; kind: string; currency: string; payableAmount: string; minimumAmount: string | null; maximumAmount: string | null; validUntil: string | null };

export function usePaymentMethods(countryCode: string, currency: string, amount: string) {
  const requestKey = `${countryCode}:${currency}:${amount}`;
  const [result, setResult] = useState<{ key: string; methods: CheckoutPaymentMethod[]; error: string }>({ key: "", methods: [], error: "" });
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ country: countryCode, baseCurrency: currency, amount });
    void fetch(`/api/v1/payments/providers?${query}`, { signal: controller.signal }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Payment methods are unavailable."); setResult({ key: requestKey, methods: body.data.providers, error: "" }); }).catch((reason: unknown) => { if ((reason as { name?: string }).name !== "AbortError") setResult({ key: requestKey, methods: [], error: reason instanceof Error ? reason.message : "Payment methods are unavailable." }); });
    return () => controller.abort();
  }, [countryCode, currency, amount, requestKey]);
  return { methods: result.key === requestKey ? result.methods : [], loading: result.key !== requestKey, error: result.key === requestKey ? result.error : "" };
}
