"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";

export function MarketCountrySelector({ countries, currentCountry }: { countries: { isoCode: string; name: string }[]; currentCountry: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function changeMarket(event: ChangeEvent<HTMLSelectElement>) {
    const countryCode = event.target.value;
    setSaving(true);
    setError("");
    const response = await fetch("/api/v1/catalog/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countryCode }),
    });
    const result = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setError(result?.error?.message ?? "Market could not be changed.");
    router.refresh();
  }

  return <label className="market-country-selector" title="Choose the market used to prioritize products">
    <span>Market</span><strong aria-hidden="true">{currentCountry}</strong>
    <select aria-label="Shopping market" defaultValue={countries.length ? currentCountry : ""} disabled={saving || !countries.length} onChange={changeMarket}>
      {!countries.length ? <option value="">Unavailable</option> : null}
      {countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name}</option>)}
    </select>
    {error ? <small role="alert">{error}</small> : null}
  </label>;
}
