import { notFound, redirect } from "next/navigation";

import { IdentifierPanel } from "@/components/identifier-panel";
import { PrintIdentifierButton } from "@/components/print-identifier-button";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/server-session";
import { orderCodeAccessWhere } from "@/modules/identifiers/order-access";
import { isPlatformCode } from "@/modules/identifiers/service";

export default async function OrderIdentifierPrintPage({ params }: PageProps<"/print/orders/[orderNumber]">) {
  const { orderNumber } = await params;
  if (!isPlatformCode(orderNumber) || !orderNumber.startsWith("ORD-")) notFound();
  const session = await getServerSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/print/orders/${orderNumber}`)}`);
  const where = orderCodeAccessWhere(orderNumber, session);
  const order = where ? await prisma.order.findFirst({ where, select: { orderNumber: true, items: { select: { productTitle: true }, take: 1 }, sourcingRequest: { select: { productTitle: true } } } }) : null;
  if (!order) notFound();
  const title = order.items[0]?.productTitle ?? order.sourcingRequest?.productTitle ?? "DeshDak order";
  return <main className="identifier-print-page"><div className="identifier-print-toolbar"><span>DeshDak order identifier</span><PrintIdentifierButton /></div><section className="identifier-print-sheet"><IdentifierPanel code={orderNumber} entity="order" showPrintLink={false} title={title} /><p className="identifier-print-note">This label identifies an order but does not grant access. DeshDak authentication and authorization remain required after scanning.</p></section></main>;
}
