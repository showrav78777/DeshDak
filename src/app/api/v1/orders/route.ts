import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { isVariantOperationallyAvailable } from "@/modules/cart/summary";
import { createPlatformCode } from "@/modules/identifiers/service";
import { releaseExpiredInventoryReservations } from "@/modules/inventory/reservations";
import { addressSchema } from "@/modules/users/address";
import { hasRuntimeReadyPaymentOption } from "@/modules/payments/availability";
import { claimCoupon, CouponConflict, evaluateCoupon } from "@/modules/promotions/coupons";
import { claimAutomaticPromotion, evaluateAutomaticPromotion } from "@/modules/promotions/automatic";
import { screenRestrictedGoods } from "@/modules/compliance/restricted-goods";

const checkoutSchema = z.object({ cartId: z.string().uuid(), address: addressSchema, shippingLaneId: z.string().uuid().optional(), saveAddress: z.boolean().default(true), couponCode: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()).optional() });

class CheckoutConflict extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function reservationExpiry() {
  const configured = Number.parseInt(process.env.INVENTORY_RESERVATION_MINUTES ?? "30", 10);
  const minutes = Number.isFinite(configured) ? Math.min(120, Math.max(10, configured)) : 30;
  return new Date(Date.now() + minutes * 60_000);
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to place an order.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check your cart and delivery address.", 422, z.treeifyError(parsed.error));
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ userId: session.userId, ...parsed.data })).digest("hex");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const replay = await tx.order.findUnique({ where: { checkoutIdempotencyKey: idempotencyKey }, select: { id: true, orderNumber: true, type: true, status: true, grandTotal: true, currency: true, customerId: true, checkoutRequestFingerprint: true } });
      if (replay) {
        if (replay.customerId !== session.userId) return null;
        if (replay.checkoutRequestFingerprint !== requestFingerprint) throw new CheckoutConflict("IDEMPOTENCY_KEY_REUSED", "This checkout key was already used with different order details. Refresh checkout and try again.");
        return { order: replay, replay: true };
      }
      const identity = await tx.user.findUnique({ where: { id: session.userId }, select: { phoneVerifiedAt: true, kycStatus: true } });
      if (!identity?.phoneVerifiedAt) throw new CheckoutConflict("PHONE_VERIFICATION_REQUIRED", "Verify the phone number in your account before placing an order.");
      if (identity.kycStatus !== "VERIFIED") throw new CheckoutConflict("IDENTITY_VERIFICATION_REQUIRED", identity.kycStatus === "PENDING" ? "Your identity verification is under review. You can place an order after Compliance approves it." : "Verify your identity with a Passport, National ID, or Driving Licence before placing an order.");
      await releaseExpiredInventoryReservations(tx);
      const cart = await tx.cart.findFirst({ where: { id: parsed.data.cartId, userId: session.userId, currency: "BDT" }, include: { items: { include: { productVariant: { include: { product: { include: { category: { select: { isActive: true, nameEn: true, nameBn: true } }, sellerProfile: true } } } } } } } });
      if (!cart?.items.length) return null;
      if (cart.items.some((item) => !isVariantOperationallyAvailable(item.productVariant) || item.productVariant.priceBdt === null)) throw new CheckoutConflict("CART_ITEM_UNAVAILABLE", "One or more cart items are unavailable or still require a confirmed price.");
      if (cart.items.some((item) => item.productVariant.inventoryQuantity !== null && item.quantity > item.productVariant.inventoryQuantity)) throw new CheckoutConflict("INSUFFICIENT_INVENTORY", "A seller no longer has the requested quantity. Review your cart and try again.");

      const sellerItems = cart.items.filter((item) => item.productVariant.product.sellerProfileId !== null);
      if (sellerItems.length > 0 && sellerItems.length !== cart.items.length) throw new CheckoutConflict("MIXED_FULFILLMENT_CART", "Seller products and sourced products must be checked out separately.");
      const isSellerMarketplace = sellerItems.length === cart.items.length;
      const originCodes = new Set(cart.items.map((item) => item.productVariant.product.originCountryCode));
      if (originCodes.size !== 1) throw new CheckoutConflict("MIXED_ORIGIN_CART", "Products from different origin countries must be checked out separately.");
      const originCountryCode = [...originCodes][0];
      const destinationCountryCode = parsed.data.address.countryCode;
      let shippingLaneId: string | null = null;
      let orderType: "BUY_AND_SHIP" | "LOCAL_SELLER" | "EXPORT_MARKETPLACE" = "BUY_AND_SHIP";

      if (isSellerMarketplace) {
        const invalidSellerItem = sellerItems.some((item) => { const seller = item.productVariant.product.sellerProfile; return !seller || seller.status !== "APPROVED" || seller.originCountryCode !== originCountryCode; });
        if (invalidSellerItem) throw new CheckoutConflict("SELLER_NOT_APPROVED", "A seller in this cart is not currently approved for checkout.");
        if (destinationCountryCode === originCountryCode) {
          orderType = "LOCAL_SELLER";
        } else {
          if (sellerItems.some((item) => !item.productVariant.product.isInternationallyAvailable || !item.productVariant.product.sellerProfile?.shipsInternationally)) throw new CheckoutConflict("PRODUCT_NOT_EXPORT_AVAILABLE", "A product in this cart is not available for international delivery.");
          if (!parsed.data.shippingLaneId) throw new CheckoutConflict("SHIPPING_LANE_REQUIRED", "Choose an available international delivery service.");
          const lane = await tx.shippingLane.findFirst({ where: { id: parsed.data.shippingLaneId, isActive: true, checkoutEnabled: true, financeApproved: true, complianceApproved: true, operationsApproved: true, originCountry: { is: { isoCode: originCountryCode, isActive: true } }, destinationCountry: { is: { isoCode: destinationCountryCode, isActive: true } } }, select: { id: true, destinationCountry: { select: { paymentMethods: { where: { checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { customerCurrency: true, paymentMethod: { select: { adapterCode: true } } } } } } } });
          if (!lane || !(await hasRuntimeReadyPaymentOption(tx, lane.destinationCountry.paymentMethods))) throw new CheckoutConflict("DESTINATION_NOT_AVAILABLE", "International checkout is not enabled with an approved payment method and current exchange-rate coverage for this destination yet.");
          shippingLaneId = lane.id;
          orderType = "EXPORT_MARKETPLACE";
        }
      } else if (destinationCountryCode !== "BD") {
        throw new CheckoutConflict("IMPORT_DESTINATION_UNAVAILABLE", "Sourced-product checkout is currently available only for delivery to Bangladesh.");
      }

      const compliance = await screenRestrictedGoods(tx, {
        subject: "CHECKOUT",
        customerId: session.userId,
        originCountryCode,
        destinationCountryCode,
        text: cart.items.flatMap((item) => {
          const product = item.productVariant.product;
          return [product.titleEn, product.titleBn, product.shortDescription, product.description, product.brand, product.category?.nameEn, product.category?.nameBn, JSON.stringify(item.productVariant.attributes ?? {})];
        }),
        hsCodes: cart.items.map((item) => item.productVariant.product.hsCode),
      });
      if (!compliance.allowed) {
        await tx.auditLog.create({ data: { actorId: session.userId, action: compliance.outcome === "BLOCKED" ? "compliance.checkout_blocked" : "compliance.checkout_review_required", entityType: "ComplianceScreeningAttempt", entityId: compliance.attempt.id, metadata: { matchedRuleCodes: compliance.attempt.matchedRuleCodes, cartId: cart.id, originCountryCode, destinationCountryCode } } });
        return { compliance, order: null, replay: false };
      }

      const productTotal = cart.items.reduce((sum, item) => sum.add(item.productVariant.priceBdt!.mul(item.quantity)), new Prisma.Decimal(0));
      const accountType = await tx.user.findUnique({ where: { id: session.userId }, select: { accountType: true } });
      if (!accountType) return null;
      let coupon = parsed.data.couponCode ? await evaluateCoupon(tx, { code: parsed.data.couponCode, customerId: session.userId, accountType: accountType.accountType, subtotal: productTotal }) : null;
      let automaticPromotion = await evaluateAutomaticPromotion(tx, { customerId: session.userId, accountType: accountType.accountType, subtotal: productTotal });
      if (coupon && automaticPromotion && !(coupon.allowsAutomaticStacking && automaticPromotion.allowsCouponStacking)) {
        if (coupon.discountAmount.gte(automaticPromotion.discountAmount)) automaticPromotion = null;
        else coupon = null;
      }
      let discountTotal = (coupon?.discountAmount ?? new Prisma.Decimal(0)).add(automaticPromotion?.discountAmount ?? 0);
      if (discountTotal.gte(productTotal) && coupon && automaticPromotion) {
        if (coupon.discountAmount.gte(automaticPromotion.discountAmount)) automaticPromotion = null;
        else coupon = null;
        discountTotal = coupon?.discountAmount ?? automaticPromotion?.discountAmount ?? new Prisma.Decimal(0);
      }
      const grandTotal = productTotal.minus(discountTotal);
      if (parsed.data.saveAddress) {
        const normalizedAddressLine2 = parsed.data.address.addressLine2 || null;
        const normalizedPostalCode = parsed.data.address.postalCode || null;
        const existingAddress = await tx.address.findFirst({ where: { userId: session.userId, fullName: parsed.data.address.fullName, phone: parsed.data.address.phone, addressLine1: parsed.data.address.addressLine1, addressLine2: normalizedAddressLine2, city: parsed.data.address.city, district: parsed.data.address.district, postalCode: normalizedPostalCode, countryCode: destinationCountryCode, deletedAt: null }, select: { id: true } });
        if (!existingAddress) {
          const addressCount = await tx.address.count({ where: { userId: session.userId, deletedAt: null } });
          const savedAddress = await tx.address.create({ data: { userId: session.userId, ...parsed.data.address, addressLine2: normalizedAddressLine2, postalCode: normalizedPostalCode, isDefault: addressCount === 0 }, select: { id: true, countryCode: true, isDefault: true } });
          await tx.auditLog.create({ data: { actorId: session.userId, action: "address.created_from_checkout", entityType: "Address", entityId: savedAddress.id, metadata: { countryCode: savedAddress.countryCode, isDefault: savedAddress.isDefault } } });
        }
      }

      const order = await tx.order.create({ data: { orderNumber: createPlatformCode("ORDER"), customerId: session.userId, type: orderType, status: "PENDING_PAYMENT", currency: "BDT", productTotal, discountTotal, grandTotal, checkoutIdempotencyKey: idempotencyKey, checkoutRequestFingerprint: requestFingerprint, shippingAddress: parsed.data.address, originCountryCode, destinationCountryCode, shippingLaneId, statusHistory: { create: { toStatus: "PENDING_PAYMENT", actorId: session.userId, note: orderType === "EXPORT_MARKETPLACE" ? "International seller order created. Product prices were locked for payment." : "Order created from cart. Product prices were locked for payment." } } }, select: { id: true, orderNumber: true, type: true, status: true, grandTotal: true, currency: true, customerId: true } });
      await tx.complianceScreeningAttempt.update({ where: { id: compliance.attempt.id }, data: { subjectReference: order.id } });

      if (coupon) await claimCoupon(tx, { ...coupon, customerId: session.userId, orderId: order.id, subtotal: productTotal });
      if (automaticPromotion) await claimAutomaticPromotion(tx, { ...automaticPromotion, customerId: session.userId, orderId: order.id, subtotal: productTotal });

      const reservedInventory: { orderId: string; productVariantId: string; quantity: number; expiresAt: Date }[] = [];
      for (const item of [...sellerItems].sort((a, b) => a.productVariant.id.localeCompare(b.productVariant.id))) {
        if (item.productVariant.inventoryQuantity === null) continue;
        const allocated = await tx.productVariant.updateMany({ where: { id: item.productVariant.id, inventoryQuantity: { gte: item.quantity } }, data: { inventoryQuantity: { decrement: item.quantity } } });
        if (allocated.count !== 1) throw new CheckoutConflict("INSUFFICIENT_INVENTORY", "A seller no longer has the requested quantity. Review your cart and try again.");
        reservedInventory.push({ orderId: order.id, productVariantId: item.productVariant.id, quantity: item.quantity, expiresAt: reservationExpiry() });
      }
      if (reservedInventory.length) await tx.inventoryReservation.createMany({ data: reservedInventory });

      const sellerOrderIds = new Map<string, string>();
      if (isSellerMarketplace) {
        const totals = new Map<string, Prisma.Decimal>();
        for (const item of sellerItems) { const sellerId = item.productVariant.product.sellerProfileId!; totals.set(sellerId, (totals.get(sellerId) ?? new Prisma.Decimal(0)).add(item.productVariant.priceBdt!.mul(item.quantity))); }
        for (const [sellerProfileId, productSubtotal] of totals) {
          const sellerOrder = await tx.sellerOrder.create({ data: { orderId: order.id, sellerProfileId, productSubtotal, statusHistory: { create: { toStatus: "PENDING_PAYMENT", actorId: session.userId, note: "Customer checkout created; awaiting verified payment." } } }, select: { id: true } });
          sellerOrderIds.set(sellerProfileId, sellerOrder.id);
        }
      }

      await tx.orderItem.createMany({ data: cart.items.map((item) => ({ orderId: order.id, productId: item.productVariant.product.id, productVariantId: item.productVariant.id, sellerOrderId: item.productVariant.product.sellerProfileId ? sellerOrderIds.get(item.productVariant.product.sellerProfileId) : null, productTitle: item.productVariant.product.titleEn, variantSnapshot: item.productVariant.attributes ?? (item.productVariant.sku ? { sku: item.productVariant.sku } : Prisma.JsonNull), quantity: item.quantity, unitPrice: item.productVariant.priceBdt!, total: item.productVariant.priceBdt!.mul(item.quantity) })) });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "order.created_from_cart", entityType: "Order", entityId: order.id, metadata: { type: orderType, itemCount: cart.items.length, sellerCount: sellerOrderIds.size, originCountryCode, destinationCountryCode, shippingLaneId, productTotal: productTotal.toFixed(2), discountTotal: discountTotal.toFixed(2), couponCode: coupon?.code ?? null, automaticPromotionId: automaticPromotion?.promotionId ?? null, automaticPromotionName: automaticPromotion?.name ?? null, currency: "BDT" } } });
      return { order, replay: false };
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 });

    if (!result) return apiError("CHECKOUT_NOT_AVAILABLE", "This cart is empty or the checkout request cannot be reused.", 409);
    if ("compliance" in result && result.compliance) return apiError(result.compliance.outcome === "BLOCKED" ? "RESTRICTED_GOODS_BLOCKED" : "COMPLIANCE_REVIEW_REQUIRED", result.compliance.customerMessage ?? "This checkout cannot continue until a compliance review is completed.", result.compliance.outcome === "BLOCKED" ? 422 : 409, { screeningReference: result.compliance.attempt.id });
    return apiSuccess({ order: { id: result.order.id, orderNumber: result.order.orderNumber, type: result.order.type, status: result.order.status, grandTotal: result.order.grandTotal, currency: result.order.currency }, idempotentReplay: result.replay, nextAction: "PAYMENT_REQUIRED" }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof CouponConflict) return apiError(error.code, error.message, 409);
    if (error instanceof CheckoutConflict) return apiError(error.code, error.message, 409);
    if ((error as { code?: string }).code === "P2034") return apiError("CHECKOUT_RETRY_REQUIRED", "Your cart changed during checkout. Please review it and retry.", 409);
    if ((error as { code?: string }).code === "P2028") {
      const response = apiError("CHECKOUT_TEMPORARILY_UNAVAILABLE", "Checkout took too long. Please retry using the same checkout request.", 503);
      response.headers.set("Retry-After", "2");
      return response;
    }
    throw error;
  }
}
