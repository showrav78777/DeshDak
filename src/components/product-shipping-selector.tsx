"use client";

import { useEffect, useRef, useState } from "react";

export type ProductShippingLane = {
  id: string;
  name: string;
  transitDaysMin: number | null;
  transitDaysMax: number | null;
  originName: string;
  destinationName: string;
  estimatedRateBdtPerKg?: number | null;
  estimatedLastMileRateBdtPerKg?: number | null;
  estimatedHandlingFeeBdt?: number | null;
  estimatedMinimumChargeBdt?: number | null;
  packedWeightGrams?: number | null;
  checkoutReady?: boolean;
  demoRateBdtPerKg?: number;
  demoOnly?: boolean;
};

function shippingMode(lane: ProductShippingLane) {
  const value = lane.name.toLowerCase();
  if (value.includes("sea") || value.includes("ocean")) return "Sea freight";
  if (value.includes("air") || value.includes("cargo")) return "Air cargo";
  return "International delivery";
}

function timing(lane: ProductShippingLane) {
  if (lane.transitDaysMin !== null && lane.transitDaysMax !== null) return `${lane.transitDaysMin}–${lane.transitDaysMax} days`;
  if (lane.transitDaysMin !== null) return `${lane.transitDaysMin}+ days`;
  return "Timing confirmed with your final quote";
}

function estimateFor(lane: ProductShippingLane) {
  const rate = lane.demoRateBdtPerKg ?? lane.estimatedRateBdtPerKg;
  if (rate === undefined || rate === null) return null;
  const weightKg = lane.packedWeightGrams && lane.packedWeightGrams > 0 ? lane.packedWeightGrams / 1000 : null;
  const handling = lane.estimatedHandlingFeeBdt ?? 0;
  const minimum = lane.estimatedMinimumChargeBdt ?? 0;
  const parcelEstimate = weightKg === null ? null : Math.max((rate + (lane.estimatedLastMileRateBdtPerKg ?? 0)) * weightKg + handling, minimum);
  return { rate, weightKg, handling, parcelEstimate };
}

function rateText(lane: ProductShippingLane) {
  const estimate = estimateFor(lane);
  if (!estimate) return "Measured quote";
  if (estimate.parcelEstimate !== null) return `Approx. ৳${Math.ceil(estimate.parcelEstimate).toLocaleString("en-BD")}`;
  return `Approx. ৳${estimate.rate.toLocaleString("en-BD")}/kg`;
}

export function ProductShippingSelector({ destinationLabel, domestic, lanes, demoRates = [] }: { destinationLabel: string; domestic: boolean; lanes: ProductShippingLane[]; demoRates?: ProductShippingLane[] }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeDialog = () => setOpen(false);
  const [mode, setMode] = useState<"ALL" | "AIR" | "SEA">("ALL");
  const selectableLanes = [...lanes, ...demoRates];
  const [selectedId, setSelectedId] = useState(selectableLanes[0]?.id ?? "");
  const [pendingId, setPendingId] = useState(selectedId);
  const selected = selectableLanes.find((lane) => lane.id === selectedId) ?? selectableLanes[0];
  const pending = selectableLanes.find((lane) => lane.id === pendingId) ?? selected;
  function openDialog() {
    setPendingId(selected?.id ?? "");
    setMode("ALL");
    setOpen(true);
  }
  function applySelection() {
    if (pending) setSelectedId(pending.id);
    closeDialog();
  }
  const visibleLanes = selectableLanes.filter((lane) => mode === "ALL" || (mode === "AIR" ? shippingMode(lane) === "Air cargo" : shippingMode(lane) === "Sea freight"));

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [open]);

  const selectedEstimate = selected ? estimateFor(selected) : null;
  const routeTitle = domestic ? "Bangladesh local delivery" : selected ? shippingMode(selected) : "International shipping";
  const routeCopy = domestic
    ? "Your courier charge is confirmed from the packed weight and delivery address."
    : selected
      ? `${selected.originName} → ${selected.destinationName} · ${timing(selected)}.${selectedEstimate ? ` Planning rate from ৳${selectedEstimate.rate.toLocaleString("en-BD")}/kg.` : " Final price follows warehouse measurement."}`
      : "Choose air or sea service after warehouse measurement and quote approval.";

  return <>
    <div className="product-delivery-card-heading"><span aria-hidden="true">▣</span><b>Delivery to {destinationLabel}</b></div>
    <div className="product-route-card"><span aria-hidden="true">{domestic ? "▣" : selected && shippingMode(selected) === "Sea freight" ? "⚓" : "✈"}</span><div><b>{routeTitle}</b><small>{routeCopy}</small></div></div>
    {!domestic ? <button className="product-route-link" type="button" onClick={openDialog}>Compare shipping options →</button> : null}
    {open ? <div className="shipping-selector-backdrop" role="presentation" onClickCapture={(event) => { if ((event.target as HTMLElement).closest("[data-shipping-close]")) closeDialog(); }} onPointerDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}><section ref={dialogRef} aria-describedby="shipping-selector-description" aria-labelledby="shipping-selector-title" aria-modal="true" className="shipping-selector-modal" onPointerDown={(event) => event.stopPropagation()} role="dialog"><header><div><p className="eyebrow">DeshDak DELIVERY</p><h2 id="shipping-selector-title">Choose a shipping service</h2><p id="shipping-selector-description">We estimate from this product’s packed weight and your selected destination. The warehouse measures actual and volumetric weight before a final price is sent for your approval.</p></div><button className="shipping-selector-close" data-shipping-close type="button" onClick={closeDialog}><span aria-hidden="true">×</span><span>Close</span></button></header><div className="shipping-selector-controls"><div role="group" aria-label="Shipping mode"><button className={mode === "ALL" ? "is-active" : ""} type="button" onClick={() => setMode("ALL")}>All routes</button><button className={mode === "AIR" ? "is-active" : ""} type="button" onClick={() => setMode("AIR")}>Air cargo</button><button className={mode === "SEA" ? "is-active" : ""} type="button" onClick={() => setMode("SEA")}>Sea freight</button></div><span>{destinationLabel}</span></div><div className="shipping-selector-list">{visibleLanes.length ? visibleLanes.map((lane) => { const estimate = estimateFor(lane); return <button className={`shipping-selector-option${pending?.id === lane.id ? " is-selected" : ""}`} key={lane.id} type="button" aria-pressed={pending?.id === lane.id} onClick={() => setPendingId(lane.id)}><span className="shipping-selector-radio" aria-hidden="true" /><span className="shipping-selector-service"><b>{lane.name}</b><small>{shippingMode(lane)} · {timing(lane)}</small><small>{lane.originName} → {lane.destinationName}</small>{estimate?.weightKg ? <small>Estimate uses declared packed weight: {estimate.weightKg.toFixed(2)} kg</small> : null}{lane.demoOnly ? <small className="shipping-demo-label">Demo rate only — not a checkout quote</small> : !lane.checkoutReady ? <small className="shipping-demo-label">Planning estimate only — checkout payment is not yet enabled for this destination</small> : null}</span><span className="shipping-selector-price">{rateText(lane)}<span>{estimate ? estimate.parcelEstimate !== null ? `Includes estimated handling${estimate.handling ? ` ৳${estimate.handling.toLocaleString("en-BD")}` : ""}` : "Rate estimate; final after measurement" : "Final price before payment"}</span></span></button>; }) : <p className="shipping-selector-empty">No route matches this filter. Choose another shipping mode.</p>}</div><footer><p>{pending?.demoOnly ? "Demo shipping prices are for interface testing only and are never sent to checkout or a customer invoice." : "An estimate helps you compare routes. It is not a charge: the final shipping quote is calculated after warehouse measurement and requires your approval before payment."}</p><div><button className="button secondary" data-shipping-close type="button" onClick={closeDialog}>Close</button><button className="button primary" type="button" onClick={applySelection}>Apply selected option</button></div></footer></section></div> : null}
  </>;
}
