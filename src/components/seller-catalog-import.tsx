"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { CATALOG_IMPORT_FIELDS, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, type CatalogImportFieldKey, type CatalogImportMapping } from "@/modules/catalog/seller-catalog-import-fields";

type PreviewRow = { rowNumber: number; status: string; sourceData: Record<string, string>; validationErrors: { field: string; message: string }[]; productId: string | null };
type Preview = { id: string; status: string; originalFilename: string | null; totalRows: number; validRows: number; invalidRows: number; version: number; expiresAt: string; rows: PreviewRow[] };

function parseCsv(text: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"' && value.length === 0) quoted = true;
    else if (character === ",") { record.push(value); value = ""; }
    else if (character === "\n") { record.push(value); records.push(record); record = []; value = ""; }
    else if (character !== "\r") value += character;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  if (value.length || record.length) { record.push(value); records.push(record); }
  return records.filter((row) => row.some((item) => item.trim().length));
}

function normalizedHeader(value: string) { return value.replace(/^\uFEFF/, "").trim(); }

function automaticMapping(headers: string[]) {
  const normalized = new Map(headers.map((header) => [header.toLowerCase().replace(/[^a-z0-9]/g, ""), header]));
  return Object.fromEntries(CATALOG_IMPORT_FIELDS.flatMap((field) => {
    const direct = normalized.get(field.key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    return direct ? [[field.key, direct]] : [];
  })) as CatalogImportMapping;
}

export function SellerCatalogImport({ categorySlugs }: { categorySlugs: string[] }) {
  const router = useRouter();
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<CatalogImportMapping>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError(""); setPreview(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) return setError("Choose a .csv file.");
    if (file.size > 512 * 1024) return setError("CSV files may be at most 512 KB.");
    try {
      const records = parseCsv(await file.text());
      if (records.length < 2) throw new Error("The CSV needs one header row and at least one product row.");
      const nextHeaders = records[0].map(normalizedHeader);
      if (nextHeaders.some((header) => !header)) throw new Error("Every CSV column needs a name.");
      if (new Set(nextHeaders).size !== nextHeaders.length) throw new Error("CSV column names must be unique.");
      if (nextHeaders.length > MAX_IMPORT_COLUMNS) throw new Error(`Use at most ${MAX_IMPORT_COLUMNS} columns.`);
      if (records.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} products at a time.`);
      setFilename(file.name); setHeaders(nextHeaders); setRows(records.slice(1)); setMapping(automaticMapping(nextHeaders));
    } catch (reason) { setFilename(""); setHeaders([]); setRows([]); setMapping({}); setError(reason instanceof Error ? reason.message : "Could not read this CSV."); }
  }

  function mapField(key: CatalogImportFieldKey, header: string) { setPreview(null); setMapping((current) => ({ ...current, [key]: header || undefined })); }

  async function requestPreview() {
    setBusy(true); setError(""); setPreview(null);
    const response = await fetch("/api/v1/seller/catalog-imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalFilename: filename, headers, rows, mapping }) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not validate this catalog.");
    setPreview(result.data.catalogImport); router.refresh();
  }

  async function confirmImport() {
    if (!preview || preview.invalidRows > 0) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/v1/seller/catalog-imports/${preview.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: preview.version, confirmation: "IMPORT_VALIDATED_CATALOG" }) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not import this catalog.");
    router.push("/seller/products"); router.refresh();
  }

  return <div className="catalog-import-workflow">
    <section className="catalog-import-step"><div className="catalog-import-step-head"><b>1</b><div><h2>Choose a CSV</h2><p>The file stays in your browser. DeshDak receives only the mapped text rows for validation.</p></div></div><div className="catalog-import-file-row"><input accept=".csv,text/csv" aria-label="Choose seller catalog CSV" onChange={chooseFile} type="file" /><a className="button secondary" download href="/templates/seller-catalog-import.csv">Download template</a></div><small>Maximum 100 products and 512 KB. Images, videos, HTML, formulas, and external product links are not imported.</small></section>
    {headers.length ? <section className="catalog-import-step"><div className="catalog-import-step-head"><b>2</b><div><h2>Map your columns</h2><p>Match your headings to DeshDak fields. Required fields must all be mapped once.</p></div></div><div className="catalog-import-mapping">{CATALOG_IMPORT_FIELDS.map((field) => <label key={field.key}><span>{field.label}{field.required ? <i>Required</i> : null}</span><select aria-label={`Map ${field.label}`} onChange={(event) => mapField(field.key, event.target.value)} value={mapping[field.key] ?? ""}><option value="">Not mapped</option>{headers.map((header) => <option disabled={Object.entries(mapping).some(([key, mapped]) => key !== field.key && mapped === header)} key={header} value={header}>{header}</option>)}</select></label>)}</div><aside className="catalog-import-category-note"><b>Active category slugs</b><span>{categorySlugs.join(" · ") || "No active categories are available."}</span></aside><button className="button primary" disabled={busy || !categorySlugs.length} onClick={requestPreview} type="button">{busy ? "Validating…" : `Preview ${rows.length} product${rows.length === 1 ? "" : "s"}`}</button></section> : null}
    {preview ? <section className="catalog-import-step catalog-import-preview"><div className="catalog-import-step-head"><b>3</b><div><h2>Review every row</h2><p>This preview expires at {new Date(preview.expiresAt).toLocaleString()}.</p></div></div><div className="catalog-import-summary"><span><b>{preview.totalRows}</b>Total</span><span className="valid"><b>{preview.validRows}</b>Valid</span><span className={preview.invalidRows ? "invalid" : "valid"}><b>{preview.invalidRows}</b>Need correction</span></div><div className="catalog-import-table-wrap"><table><thead><tr><th>CSV row</th><th>Product</th><th>SKU</th><th>Result</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.sourceData.titleEn || "Missing product name"}</td><td>{row.sourceData.sku || "—"}</td><td><b className={`import-row-${row.status.toLowerCase()}`}>{row.status}</b>{row.validationErrors.map((item, index) => <small key={`${item.field}-${index}`}>{item.field}: {item.message}</small>)}</td></tr>)}</tbody></table></div>{preview.invalidRows ? <p className="catalog-import-blocked">Correct the invalid rows in your CSV and create a new preview. DeshDak will not perform a partial import.</p> : <div className="catalog-import-confirm"><p><b>Ready for Admin moderation</b>Confirming creates {preview.validRows} private products. They will not appear to customers until Admin approves each listing.</p><button className="button primary" disabled={busy} onClick={confirmImport} type="button">{busy ? "Importing atomically…" : "Confirm catalog import"}</button></div>}</section> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}
