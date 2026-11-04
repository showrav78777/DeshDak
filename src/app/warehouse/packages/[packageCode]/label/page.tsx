import bwipjs from "bwip-js/node";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import { PrintPackageLabelButton } from "@/components/warehouse-operations";
import { prisma } from "@/lib/prisma";
import { requireWarehousePageSession } from "@/lib/warehouse-page";

function applicationOrigin() {
  const configured = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  const url = new URL(configured);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("APP_BASE_URL must use HTTPS in production.");
  return url.origin;
}

export default async function WarehousePackageLabelPage({ params }: PageProps<"/warehouse/packages/[packageCode]/label">) {
  const { access } = await requireWarehousePageSession();
  const packageCode = (await params).packageCode.trim().toUpperCase();
  const pkg = await prisma.package.findFirst({ where: { packageCode, warehouseId: { in: access.warehouseIds }, status: "MEASURED" }, select: { id: true, packageCode: true, chargeableWeightGrams: true, lengthMm: true, widthMm: true, heightMm: true, warehouse: { select: { name: true } }, order: { select: { orderNumber: true, sourcingRequest: { select: { productTitle: true, selectedVariant: true, quantity: true } }, items: { select: { productTitle: true, quantity: true, product: { select: { productCode: true } } }, take: 1 } } } } });
  if (!pkg || await prisma.package.count({ where: { id: pkg.id, isOutboundActive: true } }) !== 1) notFound();
  const item = pkg.order.items[0]; const title = pkg.order.sourcingRequest?.productTitle ?? item?.productTitle ?? "Inbound product"; const quantity = pkg.order.sourcingRequest?.quantity ?? item?.quantity ?? "—";
  const qrValue = new URL(`/warehouse/scan/${encodeURIComponent(pkg.packageCode)}`, applicationOrigin()).toString();
  const qrDataUrl = await QRCode.toDataURL(qrValue, { width: 360, margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: pkg.packageCode, includetext: true, textxalign: "center", textsize: 11, height: 12, scale: 3, paddingwidth: 12, paddingheight: 8, backgroundcolor: "FFFFFF", barcolor: "000000", textcolor: "000000" });
  const barcodeDataUrl = `data:image/svg+xml;base64,${Buffer.from(barcodeSvg).toString("base64")}`;
  return <main className="label-page"><div className="label-toolbar"><Link href={`/warehouse/packages/${pkg.packageCode}`}>← Back to package</Link><PrintPackageLabelButton packageId={pkg.id} /></div><section className="thermal-label"><header><b>DeshDak</b><span>WAREHOUSE PRODUCT LABEL</span></header><Image alt={`QR code for package ${pkg.packageCode}`} height={360} priority src={qrDataUrl} unoptimized width={360} /><div className="label-package-code"><small>PACKAGE</small><strong>{pkg.packageCode}</strong></div><div className="warehouse-package-barcode"><Image alt={`Code 128 barcode for package ${pkg.packageCode}`} height={90} src={barcodeDataUrl} unoptimized width={430} /></div><div className="label-product"><small>PRODUCT</small><h1>{title}</h1>{pkg.order.sourcingRequest?.selectedVariant ? <p><b>Variant:</b> {pkg.order.sourcingRequest.selectedVariant}</p> : null}<p><b>Quantity:</b> {quantity}</p></div><div className="label-identifier-strip"><small>ORDER</small><b>{pkg.order.orderNumber}</b>{item?.product.productCode ? <span>Product: {item.product.productCode}</span> : null}</div><div className="label-metrics"><p><small>WEIGHT</small><b>{pkg.chargeableWeightGrams} g</b></p><p><small>SIZE</small><b>{pkg.lengthMm} × {pkg.widthMm} × {pkg.heightMm} mm</b></p></div><div className="label-metrics"><p><small>WAREHOUSE</small><b>{pkg.warehouse?.name ?? "Origin"}</b></p><p><small>PRINT WIDTH</small><b>80 mm</b></p></div><footer>Scan in the authorized DeshDak Warehouse Portal. Customer PII is not encoded.</footer></section></main>;
}
