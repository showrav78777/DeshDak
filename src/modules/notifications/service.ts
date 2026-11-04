import { type NotificationChannel, type NotificationPriority, Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;

type NotificationInput = {
  userId: string;
  eventType: string;
  title: string;
  body: string;
  titleBn?: string;
  bodyBn?: string;
  deepLink?: string;
  entityType?: string;
  entityId?: string;
  priority?: NotificationPriority;
  channels?: NotificationChannel[];
  idempotencyKey: string;
};

function safeDeepLink(value?: string) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

export async function createTransactionalNotification(tx: Transaction, input: NotificationInput) {
  const requestedChannels = [...new Set(input.channels ?? ["IN_APP", "EMAIL"] as NotificationChannel[])];
  const preferences = await tx.notificationPreference.findMany({ where: { userId: input.userId, category: "TRANSACTIONAL", channel: { in: requestedChannels } }, select: { channel: true, enabled: true } });
  const disabled = new Set(preferences.filter((preference) => !preference.enabled).map((preference) => preference.channel));
  const channels = requestedChannels.filter((channel) => channel === "IN_APP" || !disabled.has(channel));
  const now = new Date();
  return tx.notification.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      userId: input.userId,
      eventType: input.eventType,
      category: "TRANSACTIONAL",
      priority: input.priority ?? "NORMAL",
      title: input.title,
      body: input.body,
      titleBn: input.titleBn ?? null,
      bodyBn: input.bodyBn ?? null,
      deepLink: safeDeepLink(input.deepLink),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      idempotencyKey: input.idempotencyKey,
      deliveries: {
        create: channels.map((channel) => ({
          channel,
          idempotencyKey: `${input.idempotencyKey}:${channel.toLowerCase()}`,
          status: channel === "IN_APP" ? "DELIVERED" : "QUEUED",
          deliveredAt: channel === "IN_APP" ? now : null,
          nextAttemptAt: channel === "EMAIL" ? now : null,
        })),
      },
    },
  });
}

export function orderNotification(input: {
  userId: string;
  orderId: string;
  orderNumber: string;
  status: string;
  eventId: string;
  note?: string | null;
}) {
  const labels: Record<string, { title: string; titleBn: string; body: string; bodyBn: string; priority?: NotificationPriority; email?: boolean }> = {
    PENDING_PURCHASE_REVIEW: { title: "Payment received", titleBn: "পেমেন্ট গ্রহণ করা হয়েছে", body: `Payment for order ${input.orderNumber} is verified. It is waiting for administrator purchase review.`, bodyBn: `${input.orderNumber} অর্ডারের পেমেন্ট যাচাই হয়েছে। এখন অ্যাডমিন ক্রয় পর্যালোচনার অপেক্ষায় আছে।`, email: true },
    PENDING_EXPORT_REVIEW: { title: "Payment received", titleBn: "পেমেন্ট গ্রহণ করা হয়েছে", body: `Payment for order ${input.orderNumber} is verified. It is waiting for seller-order review.`, bodyBn: `${input.orderNumber} অর্ডারের পেমেন্ট যাচাই হয়েছে। এখন বিক্রেতা অর্ডার পর্যালোচনার অপেক্ষায় আছে।`, email: true },
    SELLER_PREPARING: { title: "Seller is preparing your order", titleBn: "বিক্রেতা আপনার অর্ডার প্রস্তুত করছেন", body: `The seller is preparing products for order ${input.orderNumber}.`, bodyBn: `${input.orderNumber} অর্ডারের পণ্য বিক্রেতা প্রস্তুত করছেন।` },
    READY_FOR_COLLECTION: { title: "Ready for collection", titleBn: "সংগ্রহের জন্য প্রস্তুত", body: `Products for order ${input.orderNumber} are ready for collection from the seller.`, bodyBn: `${input.orderNumber} অর্ডারের পণ্য বিক্রেতার কাছ থেকে সংগ্রহের জন্য প্রস্তুত।` },
    SOURCING: { title: "Order approved for purchase", titleBn: "অর্ডার ক্রয়ের জন্য অনুমোদিত", body: `Order ${input.orderNumber} passed administrator review and is ready for purchasing.`, bodyBn: `${input.orderNumber} অর্ডারটি অ্যাডমিন পর্যালোচনা সম্পন্ন করেছে এবং ক্রয়ের জন্য প্রস্তুত।` },
    PURCHASED: { title: "Product purchased", titleBn: "পণ্য ক্রয় করা হয়েছে", body: `The products in order ${input.orderNumber} have been purchased.`, bodyBn: `${input.orderNumber} অর্ডারের পণ্যগুলো ক্রয় করা হয়েছে।` },
    SUPPLIER_SHIPPED: { title: "Supplier shipped your product", titleBn: "সরবরাহকারী পণ্য পাঠিয়েছে", body: `Order ${input.orderNumber} is on its way to the origin warehouse.`, bodyBn: `${input.orderNumber} অর্ডারটি এখন উৎস দেশের গুদামের পথে আছে।` },
    WAREHOUSE_RECEIVED: { title: "Received at origin warehouse", titleBn: "উৎস দেশের গুদামে গ্রহণ করা হয়েছে", body: `Order ${input.orderNumber} has reached the origin warehouse.`, bodyBn: `${input.orderNumber} অর্ডারটি উৎস দেশের গুদামে পৌঁছেছে।` },
    MEASURED: { title: "Package measurement complete", titleBn: "প্যাকেজ পরিমাপ সম্পন্ন", body: `Measurement is complete for order ${input.orderNumber}. Shipping will be quoted next.`, bodyBn: `${input.orderNumber} অর্ডারের পরিমাপ সম্পন্ন হয়েছে। পরবর্তী ধাপে শিপিং কোট দেওয়া হবে।` },
    SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL: { title: "Shipping quote needs your approval", titleBn: "শিপিং কোটে আপনার অনুমোদন প্রয়োজন", body: `A measured shipping quote is ready for order ${input.orderNumber}. Review it before it expires.`, bodyBn: `${input.orderNumber} অর্ডারের পরিমাপভিত্তিক শিপিং কোট প্রস্তুত। মেয়াদ শেষ হওয়ার আগে পর্যালোচনা করুন।`, priority: "HIGH", email: true },
    SHIPPING_QUOTE_READY: { title: "Shipping quote ready", titleBn: "শিপিং কোট প্রস্তুত", body: `The final shipping quote for order ${input.orderNumber} is ready.`, bodyBn: `${input.orderNumber} অর্ডারের চূড়ান্ত শিপিং কোট প্রস্তুত।`, priority: "HIGH", email: true },
    READY_TO_SHIP: { title: "Ready to ship", titleBn: "শিপিংয়ের জন্য প্রস্তুত", body: `Order ${input.orderNumber} is ready for international shipping.`, bodyBn: `${input.orderNumber} অর্ডারটি আন্তর্জাতিক শিপিংয়ের জন্য প্রস্তুত।` },
    IN_TRANSIT: { title: "Order is in transit", titleBn: "অর্ডারটি পথে আছে", body: `Order ${input.orderNumber} is on the way to Bangladesh.`, bodyBn: `${input.orderNumber} অর্ডারটি বাংলাদেশের পথে আছে।` },
    CUSTOMS: { title: "Customs processing", titleBn: "কাস্টমস প্রক্রিয়াকরণ চলছে", body: `Order ${input.orderNumber} is being processed by customs.`, bodyBn: `${input.orderNumber} অর্ডারটি কাস্টমসে প্রক্রিয়াধীন।` },
    OUT_FOR_DELIVERY: { title: "Out for delivery", titleBn: "ডেলিভারির জন্য বের হয়েছে", body: `Order ${input.orderNumber} is with the local courier for delivery.`, bodyBn: `${input.orderNumber} অর্ডারটি ডেলিভারির জন্য স্থানীয় কুরিয়ারের কাছে আছে।`, priority: "HIGH" },
    DELIVERED: { title: "Order delivered", titleBn: "অর্ডার ডেলিভারি হয়েছে", body: `Order ${input.orderNumber} has been delivered.`, bodyBn: `${input.orderNumber} অর্ডারটি ডেলিভারি হয়েছে।`, priority: "HIGH", email: true },
    ON_HOLD: { title: "Order needs attention", titleBn: "অর্ডারে আপনার মনোযোগ প্রয়োজন", body: `Order ${input.orderNumber} is on hold. Open the timeline for the confirmed update.`, bodyBn: `${input.orderNumber} অর্ডারটি স্থগিত আছে। নিশ্চিত আপডেট দেখতে টাইমলাইন খুলুন।`, priority: "HIGH" },
    REFUNDED: { title: "Refund completed", titleBn: "রিফান্ড সম্পন্ন হয়েছে", body: `The approved refund for order ${input.orderNumber} has been processed.`, bodyBn: `${input.orderNumber} অর্ডারের অনুমোদিত রিফান্ড প্রক্রিয়া সম্পন্ন হয়েছে।`, priority: "HIGH", email: true },
  };
  const content = labels[input.status];
  if (!content) return null;
  return {
    userId: input.userId,
    eventType: `ORDER_${input.status}`,
    title: content.title,
    body: input.note ? `${content.body} ${input.note}`.slice(0, 500) : content.body,
    titleBn: content.titleBn,
    bodyBn: content.bodyBn,
    deepLink: `/orders/${input.orderId}`,
    entityType: "Order",
    entityId: input.orderId,
    priority: content.priority,
    channels: content.email ? ["IN_APP", "EMAIL"] as NotificationChannel[] : ["IN_APP"] as NotificationChannel[],
    idempotencyKey: `order-event:${input.eventId}`,
  } satisfies NotificationInput;
}
