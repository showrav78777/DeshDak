import { notFound } from "next/navigation";

import { IdentifierPanel } from "@/components/identifier-panel";
import { PrintIdentifierButton } from "@/components/print-identifier-button";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/server-session";
import { productIdentifierAccess } from "@/modules/identifiers/product-access";
import { isPlatformCode } from "@/modules/identifiers/service";

export default async function ProductIdentifierPrintPage({ params }: PageProps<"/print/products/[productCode]">) {
  const { productCode } = await params;
  if (!isPlatformCode(productCode) || !productCode.startsWith("PRD-")) notFound();
  const access = await productIdentifierAccess(productCode, await getServerSession());
  const product = access ? await prisma.product.findUnique({ where: { id: access.productId }, select: { titleEn: true } }) : null;
  if (!product) notFound();
  return <main className="identifier-print-page"><div className="identifier-print-toolbar"><span>DeshDak product identifier</span><PrintIdentifierButton /></div><section className="identifier-print-sheet"><IdentifierPanel code={productCode} entity="product" showPrintLink={false} title={product.titleEn} /><p className="identifier-print-note">Scan resolves through DeshDak. No customer information, supplier credentials, or internal database identifier is encoded.</p></section></main>;
}
