import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { IdentifierPanel } from "@/components/identifier-panel";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { orderCodeAccessWhere } from "@/modules/identifiers/order-access";
import { isPlatformCode } from "@/modules/identifiers/service";

export default async function OrderScanPage({ params }: PageProps<"/scan/orders/[orderNumber]">) {
  const { orderNumber } = await params;
  if (!isPlatformCode(orderNumber) || !orderNumber.startsWith("ORD-")) notFound();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect(`/login?next=${encodeURIComponent(`/scan/orders/${orderNumber}`)}`);
  const where = orderCodeAccessWhere(orderNumber, session);
  const order = where ? await prisma.order.findFirst({ where, select: { id: true, orderNumber: true, status: true, type: true } }) : null;
  if (!order) notFound();
  if (session.portal === "warehouse" && session.roles.includes(ROLE.WAREHOUSE_WORKER)) redirect(`/warehouse/scan/${encodeURIComponent(orderNumber)}`);
  if (session.portal === "inspector" && session.roles.includes(ROLE.INSPECTOR)) redirect(`/inspector/scan/${encodeURIComponent(orderNumber)}`);
  if (session.portal === "logistics" && session.roles.includes(ROLE.LOGISTICS_WORKER)) redirect(`/logistics/scan/${encodeURIComponent(orderNumber)}`);
  if (session.portal === "customer" && session.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect(`/orders/${order.id}`);
  if (session.portal === "seller" && session.roles.includes(ROLE.SELLER)) redirect("/seller/orders");
  if (session.portal === "admin" && session.roles.includes(ROLE.ADMIN)) redirect(`/admin/orders?code=${encodeURIComponent(orderNumber)}`);
  return <main className="operational-scan-page"><section><p className="eyebrow">AUTHORIZED OPERATIONAL SCAN</p><h1>{order.orderNumber}</h1><p>Status: <b>{order.status.replaceAll("_", " ")}</b> · Type: {order.type.replaceAll("_", " ")}</p><IdentifierPanel code={order.orderNumber} entity="order" title="Verified order identifiers" /><Link className="button secondary" href="/">Return to workspace</Link></section></main>;
}
