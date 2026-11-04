import Image from "next/image";
import Link from "next/link";

type IdentifierPanelProps = {
  entity: "product" | "order";
  code: string;
  title: string;
  compact?: boolean;
  showPrintLink?: boolean;
};

export function IdentifierPanel({ entity, code, title, compact = false, showPrintLink = true }: IdentifierPanelProps) {
  const assetBase = `/api/v1/identifiers/${entity}s/${encodeURIComponent(code)}`;
  const content = <div className="identifier-panel-content">
    <div className="identifier-qr"><Image alt={`QR code for ${entity} ${code}`} height={176} loading="lazy" src={`${assetBase}/qr`} unoptimized width={176} /><span>Scan securely</span></div>
    <div className="identifier-barcode"><div className="identifier-barcode-image"><Image alt={`Code 128 barcode for ${entity} ${code}`} fill loading="lazy" sizes="430px" src={`${assetBase}/barcode`} style={{ objectFit: "contain" }} unoptimized /></div><code>{code}</code><small>DeshDak {entity} code</small></div>
    <div className="identifier-actions"><a href={`${assetBase}/qr`} rel="noreferrer" target="_blank">Open QR</a><a href={`${assetBase}/barcode`} rel="noreferrer" target="_blank">Open barcode</a>{showPrintLink ? <Link href={`/print/${entity}s/${encodeURIComponent(code)}`} target="_blank">Print label</Link> : null}</div>
  </div>;

  if (compact) return <details className="identifier-panel identifier-panel-compact"><summary><span>QR & barcode</span><code>{code}</code></summary>{content}</details>;
  return <section className="identifier-panel" aria-label={`${title} identifiers`}><div className="identifier-panel-heading"><div><p className="eyebrow">SECURE IDENTIFIERS</p><h2>{title}</h2></div><code>{code}</code></div>{content}</section>;
}
