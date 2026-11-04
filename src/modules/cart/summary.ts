import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { convertMarketAmount, getMarketMoneyContext } from "@/lib/market-money";

const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" as const },
    include: {
      productVariant: {
        select: {
          id: true,
          sku: true,
          attributes: true,
          priceBdt: true,
          stockStatus: true,
          inventoryQuantity: true,
          product: {
            select: {
              id: true,
              titleEn: true,
              titleBn: true,
              status: true,
              complianceStatus: true,
              deletedAt: true,
              originCountryCode: true,
              isInternationallyAvailable: true,
              category: { select: { isActive: true, nameEn: true } },
              sellerProfile: { select: { id: true, businessName: true, status: true, originCountryCode: true, shipsInternationally: true } },
            },
          },
        },
      },
    },
  },
};

function stockIsUnavailable(stockStatus: string | null) {
  const normalized = stockStatus?.trim().toLowerCase().replaceAll("_", " ") ?? "";
  return normalized.includes("out of stock") || normalized.includes("unavailable") || normalized.includes("sold out");
}

export async function getCartSummary(userId: string, currency = "BDT") {
  const [cart, customer] = await Promise.all([
    prisma.cart.findUnique({ where: { userId_currency: { userId, currency } }, include: cartInclude }),
    prisma.user.findUnique({ where: { id: userId }, select: { residenceCountryCode: true, accountType: true } }),
  ]);
  const money = await getMarketMoneyContext(customer?.residenceCountryCode ?? "BD", customer?.accountType ?? "PERSONAL");
  if (!cart) return { id: null, currency, displayCurrency: money.currency, displaySubtotal: "0.00", fxRateAvailable: money.rateAvailable, itemCount: 0, subtotal: "0.00", hasUnavailableItems: false, hasQuoteRequiredItems: false, fulfillmentKind: "EMPTY" as const, items: [] };

  let subtotal = new Prisma.Decimal(0);
  let itemCount = 0;
  let hasUnavailableItems = false;
  let hasQuoteRequiredItems = false;
  const items = cart.items.map((item) => {
    const variant = item.productVariant;
    const product = variant.product;
    const isAvailable = product.status === "ACTIVE" && product.complianceStatus === "CLEAR" && product.deletedAt === null && product.category?.isActive === true && (!product.sellerProfile || product.sellerProfile.status === "APPROVED") && !stockIsUnavailable(variant.stockStatus) && (variant.inventoryQuantity === null || variant.inventoryQuantity >= item.quantity);
    const quoteRequired = variant.priceBdt === null;
    const lineTotal = isAvailable && variant.priceBdt ? variant.priceBdt.mul(item.quantity) : null;
    if (!isAvailable) hasUnavailableItems = true;
    if (quoteRequired) hasQuoteRequiredItems = true;
    if (lineTotal) subtotal = subtotal.add(lineTotal);
    itemCount += item.quantity;
    return {
      id: item.id,
      quantity: item.quantity,
      isAvailable,
      quoteRequired,
      lineTotal: lineTotal?.toFixed(2) ?? null,
      displayLineTotal: convertMarketAmount(lineTotal, money),
      variant: {
        id: variant.id,
        sku: variant.sku,
        attributes: variant.attributes,
        priceBdt: variant.priceBdt?.toFixed(2) ?? null,
        displayPrice: convertMarketAmount(variant.priceBdt, money),
        stockStatus: variant.stockStatus,
      },
      product: {
        id: product.id,
        titleEn: product.titleEn,
        titleBn: product.titleBn,
        categoryName: product.category?.nameEn ?? null,
        sellerName: product.sellerProfile?.businessName ?? null,
        sellerProfileId: product.sellerProfile?.id ?? null,
        sellerStatus: product.sellerProfile?.status ?? null,
        originCountryCode: product.originCountryCode,
        isInternationallyAvailable: product.isInternationallyAvailable,
        sellerShipsInternationally: product.sellerProfile?.shipsInternationally ?? false,
      },
    };
  });

  const sellerItemCount = items.filter((item) => item.product.sellerProfileId !== null).length;
  const fulfillmentKind = sellerItemCount === 0 ? "SOURCED_IMPORT" : sellerItemCount === items.length ? "SELLER_MARKETPLACE" : "MIXED";
  return { id: cart.id, currency: cart.currency, displayCurrency: money.currency, displaySubtotal: convertMarketAmount(subtotal, money), fxRateAvailable: money.rateAvailable, itemCount, subtotal: subtotal.toFixed(2), hasUnavailableItems, hasQuoteRequiredItems, fulfillmentKind, items };
}

export function isVariantOperationallyAvailable(variant: { priceBdt: Prisma.Decimal | null; stockStatus: string | null; product: { status: string; deletedAt: Date | null; category: { isActive: boolean } | null } }) {
  return variant.product.status === "ACTIVE" && variant.product.deletedAt === null && variant.product.category?.isActive === true && !stockIsUnavailable(variant.stockStatus);
}

export function isVariantAvailable(variant: Parameters<typeof isVariantOperationallyAvailable>[0] & { product: { complianceStatus: string; sellerProfileId: string | null; sellerProfile: { status: string } | null } }) {
  const sellerAvailable = variant.product.sellerProfileId === null || variant.product.sellerProfile?.status === "APPROVED";
  return variant.product.complianceStatus === "CLEAR" && sellerAvailable && isVariantOperationallyAvailable(variant);
}
