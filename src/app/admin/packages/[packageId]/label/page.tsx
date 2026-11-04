import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { PrintPackageLabelButton } from "@/components/warehouse-operations";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export default async function PackageLabelPage({ params }: PageProps<"/admin/packages/[packageId]/label">) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value; const session = token ? await verifySession(token) : null;
  if (session?.portal !== "admin" || !session.roles.includes(ROLE.ADMIN)) redirect("/");
  const { packageId } = await params;
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, include: { order: { include: { sourcingRequest: true, items: { select: { product: { select: { productCode: true } } }, take: 1 } } }, warehouse: { select: { name: true } } } });
  if (!pkg || pkg.status !== "MEASURED") notFound();
  const qrDataUrl = await QRCode.toDataURL(pkg.packageCode, { width: 360, margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return <main className="label-page"><div className="label-toolbar"><Link href="/admin/warehouse-operations">← Back to warehouse</Link><PrintPackageLabelButton packageId={pkg.id} /></div><section className="thermal-label"><header><b>DeshDak</b><span>WAREHOUSE PRODUCT LABEL</span></header><Image alt={`QR code for package ${pkg.packageCode}`} height={360} priority src={qrDataUrl} unoptimized width={360} /><div className="label-package-code"><small>PACKAGE</small><strong>{pkg.packageCode}</strong></div><div className="label-product"><small>PRODUCT</small><h1>{pkg.order.sourcingRequest?.productTitle ?? "Buy & Ship product"}</h1>{pkg.order.sourcingRequest?.selectedVariant ? <p><b>Variant:</b> {pkg.order.sourcingRequest.selectedVariant}</p> : null}<p><b>Quantity:</b> {pkg.order.sourcingRequest?.quantity ?? "—"}</p></div><div className="label-identifier-strip"><small>ORDER BARCODE</small><Image alt={`Barcode for order ${pkg.order.orderNumber}`} height={90} src={`/api/v1/identifiers/orders/${pkg.order.orderNumber}/barcode`} unoptimized width={430} /><b>{pkg.order.orderNumber}</b>{pkg.order.items[0]?.product.productCode ? <span>Product: {pkg.order.items[0].product.productCode}</span> : null}</div><div className="label-metrics"><p><small>ORDER</small><b>{pkg.order.orderNumber}</b></p><p><small>WEIGHT</small><b>{pkg.chargeableWeightGrams} g</b></p></div><div className="label-metrics"><p><small>SIZE</small><b>{pkg.lengthMm} × {pkg.widthMm} × {pkg.heightMm} mm</b></p><p><small>WAREHOUSE</small><b>{pkg.warehouse?.name ?? "Origin"}</b></p></div><footer>Scan the opaque package reference in the authorized warehouse app.</footer></section></main>;
}
