type JourneyProps = { status: string; destinationCountryCode?: string | null };

const stages = [
  { label: "Order confirmed", states: ["DRAFT", "PENDING_PAYMENT", "PAID", "PENDING_PURCHASE_REVIEW", "PENDING_EXPORT_REVIEW", "SOURCING", "PURCHASED", "SELLER_PREPARING", "READY_FOR_COLLECTION"] },
  { label: "Origin warehouse", states: ["SUPPLIER_SHIPPED", "WAREHOUSE_RECEIVED", "INSPECTION", "MEASURED", "SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL", "SHIPPING_QUOTE_READY", "SHIPPING_PAYMENT_PENDING"] },
  { label: "International shipping", states: ["READY_TO_SHIP", "IN_TRANSIT", "CUSTOMS"] },
  { label: "Local delivery", states: ["BD_WAREHOUSE", "DESTINATION_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED"] },
];

function activeStage(status: string) {
  const position = stages.findIndex((stage) => stage.states.includes(status));
  return position < 0 ? 0 : position;
}

/** Mirrors the high-level tracker a customer sees without exposing private operational data. */
export function OrderCustomerJourney({ status, destinationCountryCode }: JourneyProps) {
  const active = activeStage(status);
  const paused = status === "ON_HOLD";
  const ended = ["CANCELLED", "REFUNDED"].includes(status);
  const destination = destinationCountryCode === "BD" || !destinationCountryCode ? "Bangladesh" : "destination";
  const summaries = ["Payment, review and purchase confirmation", "Received, inspected, measured and quoted", "Ready to ship, in transit and customs", `Hub, courier and delivery in ${destination}`];
  return <section className="order-customer-journey" aria-label="Customer-visible order tracking journey">
    <header><div><p className="eyebrow">CUSTOMER TRACKING PREVIEW</p><h3>What the customer can follow</h3></div><span className={paused || ended ? "is-exception" : ""}>{paused ? "On hold" : ended ? status.toLowerCase().replaceAll("_", " ") : `Now: ${stages[active].label}`}</span></header>
    <ol>{stages.map((stage, index) => <li className={index < active ? "complete" : index === active && !paused && !ended ? "current" : "pending"} key={stage.label}><i aria-hidden="true">{index < active ? "✓" : index + 1}</i><span><b>{stage.label}</b><small>{summaries[index]}</small></span></li>)}</ol>
    <p>Publishing the next verified status creates the customer timeline entry and in-app notification together. Internal supplier, warehouse and finance notes are never shown here.</p>
  </section>;
}
