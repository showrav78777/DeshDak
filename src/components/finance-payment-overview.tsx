type PaymentRow = { currency: string; status: string; count: number; amount: { toString(): string } | number };

export function FinancePaymentOverview({ products, shipping }: { products: PaymentRow[]; shipping: PaymentRow[] }) {
  const currencies = [...new Set([...products, ...shipping].map(row => row.currency))].sort();
  const total = (rows: PaymentRow[], currency: string) => rows.filter(row => row.currency === currency && row.status === "SUCCEEDED").reduce((sum, row) => sum + Number(row.amount.toString()), 0);
  return <section className="country-list-card"><h2>Product and shipping payment activity</h2><p>Currently successful payments created within the selected dates. Each currency is shown separately. Payment totals do not establish recognised revenue or profit.</p>{currencies.length ? currencies.map(currency => {
    const product = total(products, currency); const freight = total(shipping, currency); const peak = Math.max(product, freight, 1);
    return <article className="finance-payment-chart" key={currency}><h3>{currency}</h3>{[{ label: "Product payments", value: product }, { label: "Shipping payments", value: freight }].map(row => <div key={row.label}><span>{row.label}</span><strong>{currency} {row.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><meter aria-label={`${row.label} in ${currency}`} min={0} max={peak} value={row.value} /></div>)}</article>;
  }) : <p>No payment records in this reporting window.</p>}<p>For income and contribution reporting, Finance must first post approved product revenue, shipping revenue, supplier costs and logistics expenses to the ledger.</p></section>;
}
