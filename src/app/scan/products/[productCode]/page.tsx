import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { isPlatformCode } from "@/modules/identifiers/service";

export default async function ProductScanPage({ params }: PageProps<"/scan/products/[productCode]">) {
  const { productCode } = await params;
  if (!isPlatformCode(productCode) || !productCode.startsWith("PRD-")) notFound();
  const product = await prisma.product.findFirst({ where: { productCode, status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, category: { is: { isActive: true } } }, select: { id: true } });
  if (!product) notFound();
  redirect(`/products/${product.id}`);
}
