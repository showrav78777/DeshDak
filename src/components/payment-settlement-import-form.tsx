"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const template = "transaction_reference,bank_transaction_id,gross_amount,gateway_fee,net_amount,currency,settled_at\nPAY-EXAMPLE,BANK-EXAMPLE,1000.00,25.00,975.00,BDT,2026-09-08T12:00:00+06:00";

function parseCsvLine(line: string) {
  const cells: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += character;
  }
  if (quoted) throw new Error("A CSV row has an unclosed quote.");
  cells.push(value.trim()); return cells;
}

function parseRows(csv: string) {
  const lines = csv.replaceAll("\r\n", "\n").split("\n").filter((line) => line.trim());
  if (lines.length < 2) throw new Error("Add the header and at least one settlement row.");
  if (lines.length > 1001) throw new Error("Import no more than 1,000 rows at a time.");
  const required = ["transaction_reference", "bank_transaction_id", "gross_amount", "gateway_fee", "net_amount", "currency", "settled_at"];
  const headers = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
  if (required.some((name, index) => headers[index] !== name)) throw new Error(`Use these columns in order: ${required.join(", ")}.`);
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line); if (cells.length !== required.length) throw new Error(`Row ${index + 2} has ${cells.length} columns instead of ${required.length}.`);
    const [externalTransactionId, bankTransactionId, grossAmount, gatewayFee, netAmount, currency, settledAt] = cells;
    if (![grossAmount, gatewayFee, netAmount].every((value) => /^\d+(\.\d{1,2})?$/.test(value))) throw new Error(`Row ${index + 2} contains an invalid money value.`);
    if (!Number.isFinite(Date.parse(settledAt))) throw new Error(`Row ${index + 2} contains an invalid settlement time.`);
    return { externalTransactionId, bankTransactionId: bankTransactionId || undefined, grossAmount: Number(grossAmount), gatewayFee: Number(gatewayFee), netAmount: Number(netAmount), currency, settledAt };
  });
}

export function PaymentSettlementImportForm() {
  const router = useRouter();
  const [batchReference, setBatchReference] = useState("");
  const [settlementDate, setSettlementDate] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [csv, setCsv] = useState(template);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    try {
      const entries = parseRows(csv); setBusy(true);
      const response = await fetch("/api/v1/finance/payment-reconciliation", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ provider: "SSLCOMMERZ", externalBatchReference: batchReference, settlementDate, currency, entries }) });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error?.message ?? "The settlement report could not be imported.");
      setMessage(`Imported ${result.data.batch.rowCount} rows: ${result.data.batch.matchedCount} matched and ${result.data.batch.exceptionCount} require review.`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The CSV report could not be read."); }
    finally { setBusy(false); }
  }
  return <form className="country-create-form" onSubmit={submit}><div><label>Provider batch/report reference</label><input maxLength={100} minLength={3} onChange={(event) => setBatchReference(event.target.value)} required value={batchReference} /></div><div><label>Settlement date</label><input onChange={(event) => setSettlementDate(event.target.value)} required type="date" value={settlementDate} /></div><div><label>Currency</label><input maxLength={3} minLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} required value={currency} /></div><div className="full-width"><label>Settlement CSV rows</label><textarea onChange={(event) => setCsv(event.target.value)} rows={10} spellCheck={false} value={csv} /><small>Use the transaction reference DeshDak sent as tran_id. Amounts must be exact; net = gross − gateway fee.</small></div><button className="button primary" disabled={busy} type="submit">{busy ? "Reconciling…" : "Import and reconcile"}</button>{message ? <p className={message.startsWith("Imported") ? "form-success" : "form-error"} role="status">{message}</p> : null}</form>;
}
