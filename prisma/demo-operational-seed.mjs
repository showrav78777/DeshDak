// Fictional, repeatable operational data for local/staging demonstrations only.
export async function seedOperationalDemo({ prisma, users, products }) {
  const now = new Date();
  const address = (fullName, countryCode = "BD") => ({ label: "Demo delivery address", fullName, phone: "01700000000", addressLine1: "12 Demo Avenue", addressLine2: null, city: countryCode === "BD" ? "Dhaka" : "New York", district: countryCode === "BD" ? "Dhaka" : "New York", postalCode: countryCode === "BD" ? "1200" : "10001", countryCode, isDefault: true });
  const countryRows = [
    ["BD", "Bangladesh", "BDT"], ["CN", "China", "CNY"], ["US", "United States", "USD"], ["AU", "Australia", "AUD"],
  ];
  const countries = {};
  for (const [isoCode, name, defaultCurrency] of countryRows) {
    countries[isoCode] = await prisma.country.upsert({ where: { isoCode }, update: { name, defaultCurrency, isActive: true }, create: { isoCode, name, defaultCurrency, defaultLocale: "en", isActive: true } });
  }

  const ssl = await prisma.paymentMethod.upsert({
    where: { code: "SSLCOMMERZ" },
    update: { displayName: "SSLCommerz Sandbox", kind: "CARD", adapterCode: "SSLCOMMERZ", settlementCurrency: "BDT", isActive: true },
    create: { code: "SSLCOMMERZ", displayName: "SSLCommerz Sandbox", kind: "CARD", adapterCode: "SSLCOMMERZ", settlementCurrency: "BDT", secretReference: "demo://sslcommerz/sandbox", isActive: true },
  });
  // The current SSLCommerz adapter only settles BDT; do not make USD/AUD
  // checkout appear ready until an approved international gateway is connected.
  await prisma.countryPaymentMethod.updateMany({ where: { paymentMethodId: ssl.id, countryId: { not: countries.BD.id } }, data: { checkoutEnabled: false, financeApproved: false, complianceApproved: false, refundsApproved: false, reconciliationApproved: false } });
  for (const [countryCode, customerCurrency] of [["BD", "BDT"]]) {
    await prisma.countryPaymentMethod.upsert({
      where: { countryId_paymentMethodId_customerCurrency: { countryId: countries[countryCode].id, paymentMethodId: ssl.id, customerCurrency } },
      update: { financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, checkoutEnabled: true },
      create: { countryId: countries[countryCode].id, paymentMethodId: ssl.id, customerCurrency, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, checkoutEnabled: true },
    });
  }

  for (const [quoteCurrency, marketRate] of [["USD", "0.00820000"], ["AUD", "0.01230000"]]) {
    for (const customerSegment of ["PERSONAL", "BUSINESS"]) {
      const existing = await prisma.exchangeRate.findFirst({ where: { sourceReference: `DEMO-SEED:BDT-${quoteCurrency}-${customerSegment}`, status: "ACTIVE" } });
      if (!existing) await prisma.exchangeRate.create({ data: { baseCurrency: "BDT", quoteCurrency, customerSegment, marketRate, spreadPercent: "0", source: "MANUAL", sourceReference: `DEMO-SEED:BDT-${quoteCurrency}-${customerSegment}`, status: "ACTIVE", financeApproved: true, complianceApproved: true, validFrom: new Date(now.getTime() - 86_400_000), createdById: users.admin.id, activatedAt: now } });
    }
  }

  // Fictional planning figures, intentionally separate from payable quotes.
  // They exist so the From → To customer flow can be tested for Bangladesh,
  // USA and Australia without representing a carrier's commercial tariff.
  const laneDefinitions = [
    ["CN", "BD", "Air cargo", 5000, 7, 12, "800", "90", "50", "800"],
    ["CN", "BD", "Sea freight", 5000, 28, 45, "260", "90", "80", "500"],
    ["BD", "BD", "Bangladesh courier", 5000, 1, 4, "90", "0", "30", "80"],
    ["BD", "US", "International air", 5000, 8, 14, "2100", "280", "250", "2200"],
    ["BD", "AU", "International air", 5000, 9, 16, "2200", "300", "250", "2300"],
    ["CN", "US", "Express air cargo", 5000, 8, 14, "1950", "250", "200", "1900"],
    ["CN", "US", "Economy sea freight", 5000, 35, 55, "680", "190", "250", "1200"],
    ["CN", "AU", "Express air cargo", 5000, 8, 15, "1750", "220", "180", "1800"],
    ["CN", "AU", "Economy sea freight", 5000, 32, 50, "620", "180", "220", "1100"],
  ];
  const lanes = {};
  for (const [origin, destination, name, divisor, minDays, maxDays, estimatedRatePerKgBdt, estimatedLastMileRatePerKgBdt, estimatedHandlingFeeBdt, estimatedMinimumChargeBdt] of laneDefinitions) {
    const lane = await prisma.shippingLane.upsert({
      where: { originCountryId_destinationCountryId_name: { originCountryId: countries[origin].id, destinationCountryId: countries[destination].id, name } },
      update: { dimensionalWeightDivisor: divisor, transitDaysMin: minDays, transitDaysMax: maxDays, estimatedRatePerKgBdt, estimatedLastMileRatePerKgBdt, estimatedHandlingFeeBdt, estimatedMinimumChargeBdt, isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true, checkoutEnabled: true },
      create: { originCountryId: countries[origin].id, destinationCountryId: countries[destination].id, name, dimensionalWeightDivisor: divisor, transitDaysMin: minDays, transitDaysMax: maxDays, estimatedRatePerKgBdt, estimatedLastMileRatePerKgBdt, estimatedHandlingFeeBdt, estimatedMinimumChargeBdt, isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true, checkoutEnabled: true },
    });
    lanes[`${origin}-${destination}-${name}`] = lane;
  }

  for (const [key, countryCode] of Array.from({ length: 30 }, (_, index) => [`customer${String(index + 1).padStart(2, "0")}`, index % 5 === 0 ? "US" : "BD"])) {
    const existing = await prisma.address.findFirst({ where: { userId: users[key].id, deletedAt: null } });
    if (existing) await prisma.address.update({ where: { id: existing.id }, data: address(users[key].fullName, countryCode) });
    else await prisma.address.create({ data: { userId: users[key].id, ...address(users[key].fullName, countryCode) } });
  }

  for (const [key, balance] of [["customer02", "25000.00"], ["customer03", "12000.00"], ["customer05", "8500.00"], ["customer06", "400.00"], ["customer10", "5000.00"]]) {
    const wallet = await prisma.wallet.upsert({ where: { userId_currency: { userId: users[key].id, currency: "BDT" } }, update: { availableBalance: balance }, create: { userId: users[key].id, currency: "BDT", availableBalance: balance } });
    const eventId = `demo-wallet-${key}`;
    const journal = await prisma.financialJournal.upsert({ where: { eventType_eventId: { eventType: "DEMO_WALLET_CREDIT", eventId } }, update: {}, create: { reference: `JRN-DEMO-${key.toUpperCase()}`, eventType: "DEMO_WALLET_CREDIT", eventId, currency: "BDT", description: "Fictional demo wallet credit.", entries: { create: [{ accountCode: "CUSTOMER_WALLET_LIABILITY", direction: "CREDIT", amount: balance, currency: "BDT", memo: "Demo balance" }, { accountCode: "DEMO_TESTING_OFFSET", direction: "DEBIT", amount: balance, currency: "BDT", memo: "Demo balance" }] } } });
    await prisma.walletTransaction.upsert({ where: { idempotencyKey: `demo-wallet-credit-${key}` }, update: {}, create: { walletId: wallet.id, reference: `WAL-DEMO-${key.toUpperCase()}`, type: "MANUAL_CREDIT", status: "POSTED", amount: balance, currency: "BDT", balanceBefore: "0", balanceAfter: balance, description: "Fictional demo credit for testing only.", sourceType: "DEMO_SEED", sourceId: key, idempotencyKey: `demo-wallet-credit-${key}`, journalId: journal.id } });
  }

  const cnWarehouse = await ensureWarehouse(prisma, "Demo China Warehouse", "CN", "ORIGIN_HUB");
  const bdWarehouse = await ensureWarehouse(prisma, "Demo Bangladesh Warehouse", "BD", "DESTINATION_HUB");
  for (const employee of [users.warehouse01, users.warehouse02, users.inspector01, users.inspector02, users.logistics01, users.logistics02]) await prisma.warehouseStaffAssignment.upsert({ where: { userId_warehouseId: { userId: employee.id, warehouseId: cnWarehouse.id } }, update: { isActive: true }, create: { userId: employee.id, warehouseId: cnWarehouse.id, assignedById: users.admin.id, isActive: true } });
  for (const employee of [users.logistics01, users.logistics02, users.warehouse02]) await prisma.warehouseStaffAssignment.upsert({ where: { userId_warehouseId: { userId: employee.id, warehouseId: bdWarehouse.id } }, update: { isActive: true }, create: { userId: employee.id, warehouseId: bdWarehouse.id, assignedById: users.admin.id, isActive: true } });

  const variants = await Promise.all([products[2], products[23], products[31]].map((product) => prisma.productVariant.findFirstOrThrow({ where: { productId: product.id }, orderBy: { createdAt: "asc" } })));
  const air = await ensureOrder(prisma, { number: "ORD-DEMO-AIR-001", customer: users.customer03, product: products[23], variant: variants[1], lane: lanes["CN-BD-Air cargo"], status: "SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL", type: "BUY_AND_SHIP", total: "3850.00", origin: "CN", destination: "BD", actorId: users.admin.id });
  const sea = await ensureOrder(prisma, { number: "ORD-DEMO-SEA-001", customer: users.customer05, product: products[31], variant: variants[2], lane: lanes["CN-BD-Sea freight"], status: "IN_TRANSIT", type: "BUY_AND_SHIP", total: "7800.00", origin: "CN", destination: "BD", actorId: users.admin.id });
  const local = await ensureOrder(prisma, { number: "ORD-DEMO-LOCAL-001", customer: users.customer02, product: products[2], variant: variants[0], lane: lanes["BD-BD-Bangladesh courier"], status: "DELIVERED", type: "LOCAL_SELLER", total: "1495.00", origin: "BD", destination: "BD", actorId: users.admin.id });
  const payable = await ensureOrder(prisma, { number: "ORD-DEMO-PAYMENT-001", customer: users.customer02, product: products[2], variant: variants[0], lane: lanes["BD-BD-Bangladesh courier"], status: "PENDING_PAYMENT", type: "LOCAL_SELLER", total: "2825.00", origin: "BD", destination: "BD", actorId: users.customer02.id });
  const workflowOrders = [];
  const workflowDefinitions = [
    ["ORD-DEMO-DRAFT-001", "customer01", 4, "DRAFT", "BUY_AND_SHIP", "CN", "BD", "CN-BD-Air cargo", "1190.00"],
    ["ORD-DEMO-PAID-001", "customer07", 7, "PAID", "LOCAL_SELLER", "BD", "BD", "BD-BD-Bangladesh courier", "1680.00"],
    ["ORD-DEMO-SOURCING-001", "customer08", 10, "SOURCING", "BUY_AND_SHIP", "CN", "BD", "CN-BD-Air cargo", "4600.00"],
    ["ORD-DEMO-SUPPLIER-001", "customer09", 13, "SUPPLIER_SHIPPED", "BUY_AND_SHIP", "CN", "BD", "CN-BD-Sea freight", "5900.00"],
    ["ORD-DEMO-WAREHOUSE-001", "customer10", 16, "WAREHOUSE_RECEIVED", "SHIP_FOR_ME", "CN", "BD", "CN-BD-Air cargo", "2700.00"],
    ["ORD-DEMO-INSPECTION-001", "customer11", 19, "INSPECTION", "SHIP_FOR_ME", "CN", "BD", "CN-BD-Air cargo", "3150.00"],
    ["ORD-DEMO-MEASURED-001", "customer12", 22, "MEASURED", "BUY_AND_SHIP", "CN", "BD", "CN-BD-Air cargo", "4500.00"],
    ["ORD-DEMO-CUSTOMS-001", "customer13", 25, "CUSTOMS", "BUY_AND_SHIP", "CN", "BD", "CN-BD-Sea freight", "6800.00"],
    ["ORD-DEMO-BD-WH-001", "customer14", 28, "BD_WAREHOUSE", "BUY_AND_SHIP", "CN", "BD", "CN-BD-Sea freight", "7200.00"],
    ["ORD-DEMO-OUT-001", "customer15", 35, "OUT_FOR_DELIVERY", "LOCAL_SELLER", "BD", "BD", "BD-BD-Bangladesh courier", "1990.00"],
    ["ORD-DEMO-CANCELLED-001", "customer16", 38, "CANCELLED", "BUY_AND_SHIP", "CN", "BD", "CN-BD-Air cargo", "2500.00"],
    ["ORD-DEMO-REFUNDED-001", "customer17", 41, "REFUNDED", "LOCAL_SELLER", "BD", "BD", "BD-BD-Bangladesh courier", "1250.00"],
    ["ORD-DEMO-US-001", "customer06", 44, "PENDING_EXPORT_REVIEW", "EXPORT_MARKETPLACE", "BD", "US", "BD-US-International air", "35.00"],
  ];
  for (const [number, customerKey, productIndex, status, type, origin, destination, laneKey, total] of workflowDefinitions) {
    const product = products[productIndex];
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id }, orderBy: { createdAt: "asc" } });
    workflowOrders.push(await ensureOrder(prisma, { number, customer: users[customerKey], product, variant, lane: lanes[laneKey], status, type, total, origin, destination, actorId: users.admin.id, currency: destination === "US" ? "USD" : "BDT" }));
  }
  await prisma.inventoryReservation.upsert({ where: { orderId_productVariantId: { orderId: payable.id, productVariantId: variants[0].id } }, update: { quantity: 1, status: "ACTIVE", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }, create: { orderId: payable.id, productVariantId: variants[0].id, quantity: 1, status: "ACTIVE", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });

  await upsertShippingQuote(prisma, air, lanes["CN-BD-Air cargo"], users.admin.id, { rate: "800", international: "1920", lastMileRate: "90", lastMile: "216", handling: "50", insurance: "20", total: "2206", status: "SENT", weight: 2400, note: "Demo air quote: international cargo plus Bangladesh courier delivery." });
  await upsertShippingQuote(prisma, sea, lanes["CN-BD-Sea freight"], users.admin.id, { rate: "260", international: "1560", lastMileRate: "90", lastMile: "540", handling: "80", insurance: "30", total: "2210", status: "PAID", weight: 6000, note: "Demo sea quote paid: includes Bangladesh courier delivery." });
  await upsertShippingQuote(prisma, workflowOrders[6], lanes["CN-BD-Air cargo"], users.finance01.id, { rate: "820", international: "1640", lastMileRate: "95", lastMile: "190", handling: "60", insurance: "25", total: "1915", status: "SENT", weight: 2000, note: "Demo quote sent for customer review." });

  for (const [order, reference, status, amount] of [[payable, "PAY-DEMO-PENDING-001", "PENDING", "2825.00"], [workflowOrders[1], "PAY-DEMO-SUCCEEDED-001", "SUCCEEDED", "1680.00"], [workflowOrders[11], "PAY-DEMO-REFUNDED-001", "REFUNDED", "1250.00"]]) {
    await prisma.paymentIntent.upsert({
      where: { reference }, update: { status, amount },
      create: { reference, idempotencyKey: `demo-${reference.toLowerCase()}`, provider: "SSLCOMMERZ_DEMO", paymentMethodId: ssl.id, orderId: order.id, amount, currency: "BDT", status, gatewayPayload: { demo: true, scenario: status } },
    });
  }

  for (const [code, name, discountType, discountValue, status] of [["WELCOME10", "Welcome 10%", "PERCENTAGE", "10", "ACTIVE"], ["SHIP200", "Shipping discount", "FIXED_AMOUNT", "200", "ACTIVE"], ["EXPIRED50", "Expired demonstration coupon", "FIXED_AMOUNT", "50", "EXPIRED"]]) {
    await prisma.coupon.upsert({ where: { code }, update: { status }, create: { code, name, description: "Fictional demo coupon for checkout testing.", discountType, discountValue, minimumOrderAmount: "500", maximumDiscount: discountType === "PERCENTAGE" ? "500" : null, totalUsageLimit: 500, status, startsAt: new Date(now.getTime() - 7 * 86_400_000), endsAt: new Date(now.getTime() + (status === "EXPIRED" ? -86_400_000 : 30 * 86_400_000)) } });
  }
  for (const [adCode, placement, title, displayOrder] of [["AD-DEMO-HOME-01", "HOME_FEED", "Demo home promotion", 1], ["AD-DEMO-POPUP-01", "ENTRY_POPUP", "Demo welcome offer", 1], ["AD-DEMO-REELS-01", "REELS", "Demo Reel sponsor", 1], ["AD-DEMO-CART-01", "CART", "Demo cart delivery offer", 1]]) {
    await prisma.advertisement.upsert({ where: { adCode }, update: { status: "ACTIVE", displayOrder }, create: { adCode, advertiserName: "DUAR Demo Partner", title, body: "Fictional advertisement for page-placement testing.", targetUrl: "/products", placement, status: "ACTIVE", displayOrder, isDismissible: true, startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 30 * 86_400_000), createdById: users.admin.id } });
  }

  const airPackage = await ensurePackage(prisma, air.id, "PKG-DEMO-AIR-001", cnWarehouse.id, "MEASURED", 2200, 2400, "CN-DEMO-AIR-001");
  const seaPackage = await ensurePackage(prisma, sea.id, "PKG-DEMO-SEA-001", cnWarehouse.id, "SHIPPED", 5800, 6000, "CN-DEMO-SEA-001");
  const localPackage = await ensurePackage(prisma, local.id, "PKG-DEMO-LOCAL-001", bdWarehouse.id, "SHIPPED", 700, 700, "BD-DEMO-LOCAL-001");
  await ensureShipment(prisma, { tracking: "TRK-DEMO-SEA-001", status: "IN_TRANSIT", carrier: "Demo Sea Freight", originWarehouseId: cnWarehouse.id, destinationWarehouseId: bdWarehouse.id, packageId: seaPackage.id, actorId: users.logistics01.id, description: "Demo sea shipment departed origin warehouse." });
  await ensureShipment(prisma, { tracking: "TRK-DEMO-LOCAL-001", status: "DELIVERED", carrier: "Demo Bangladesh Courier", originWarehouseId: bdWarehouse.id, destinationWarehouseId: bdWarehouse.id, packageId: localPackage.id, actorId: users.logistics01.id, description: "Demo local courier delivery completed." });
  await prisma.packageEvent.upsert({ where: { id: "demo-air-measured-event" }, update: {}, create: { id: "demo-air-measured-event", packageId: airPackage.id, eventType: "MEASURED", status: "MEASURED", actorId: users.warehouse01.id, locationCode: "CN-DEMO", note: "Measured for demo final shipping quote." } });

  for (const [key, availability] of [["support01", "AVAILABLE"], ["support02", "BUSY"], ["support03", "OFFLINE"]]) await prisma.supportAgentProfile.upsert({ where: { userId: users[key].id }, update: { availability, acceptingNewTickets: true, maxActiveTickets: 20 }, create: { userId: users[key].id, availability, acceptingNewTickets: true, maxActiveTickets: 20, languages: ["bn", "en"], updatedById: users.admin.id } });
  const ticket = await prisma.ticket.upsert({ where: { reference: "TKT-DEMO-SHIPPING-001" }, update: { status: "ASSIGNED", assignedAgentId: users.support01.id }, create: { reference: "TKT-DEMO-SHIPPING-001", idempotencyKey: "demo-ticket-shipping-001", customerId: users.customer04.id, assignedAgentId: users.support01.id, orderId: sea.id, category: "SHIPPING", subject: "Where is my demo sea shipment?", status: "ASSIGNED", priority: "HIGH", slaDueAt: new Date(now.getTime() + 86_400_000) } });
  const conversation = await prisma.conversation.upsert({ where: { ticketId: ticket.id }, update: {}, create: { ticketId: ticket.id, status: "OPEN" } });
  await prisma.conversationMessage.upsert({ where: { idempotencyKey: "demo-ticket-message-customer" }, update: {}, create: { idempotencyKey: "demo-ticket-message-customer", conversationId: conversation.id, senderId: users.customer04.id, body: "This is a fictional support message for testing the customer-service workflow." } });
  await prisma.conversationMessage.upsert({ where: { idempotencyKey: "demo-ticket-message-agent" }, update: {}, create: { idempotencyKey: "demo-ticket-message-agent", conversationId: conversation.id, senderId: users.support01.id, body: "Your demonstration shipment is in transit. This reply is fictional test data." } });
  for (const [index, category, status, priority, customerKey, agentKey, subject] of [[2, "PAYMENT", "OPEN", "URGENT", "customer07", "support02", "Payment verification needed"], [3, "RETURN_REFUND", "WAITING_FOR_CUSTOMER", "HIGH", "customer09", "support01", "Demo refund question"], [4, "SOURCING", "ASSIGNED", "NORMAL", "customer08", "support03", "Can you source this item?"], [5, "ACCOUNT", "RESOLVED", "LOW", "customer01", "support01", "Update account information"], [6, "TECHNICAL", "CLOSED", "NORMAL", "customer06", "support02", "Demo technical issue"]]) {
    const reference = `TKT-DEMO-${String(index).padStart(3, "0")}`;
    const demoTicket = await prisma.ticket.upsert({ where: { reference }, update: { status, assignedAgentId: users[agentKey].id }, create: { reference, idempotencyKey: `demo-ticket-${index}`, customerId: users[customerKey].id, assignedAgentId: users[agentKey].id, category, subject, status, priority, slaDueAt: new Date(now.getTime() + (index - 4) * 86_400_000), resolvedAt: status === "RESOLVED" || status === "CLOSED" ? now : null } });
    const demoConversation = await prisma.conversation.upsert({ where: { ticketId: demoTicket.id }, update: { status: status === "CLOSED" ? "CLOSED" : "OPEN" }, create: { ticketId: demoTicket.id, status: status === "CLOSED" ? "CLOSED" : "OPEN" } });
    await prisma.conversationMessage.upsert({ where: { idempotencyKey: `demo-ticket-${index}-customer-message` }, update: {}, create: { idempotencyKey: `demo-ticket-${index}-customer-message`, conversationId: demoConversation.id, senderId: users[customerKey].id, body: "Fictional customer message for testing this support status." } });
  }

  for (const [user, title, body, link] of [[users.customer03, "Final air shipping quote ready", "Review the measured international and Bangladesh courier charges.", `/orders/${air.id}`], [users.customer05, "Sea shipment departed", "Your fictional demonstration shipment is in transit.", `/orders/${sea.id}`], [users.customer02, "Local delivery completed", "Your Bangladesh seller demo order was delivered.", `/orders/${local.id}`], [users.customer07, "Payment needs review", "Open your fictional payment workflow to test follow-up actions.", `/orders/${workflowOrders[1].id}`], [users.customer10, "Warehouse receipt recorded", "Your demonstration parcel is ready for inspection.", `/orders/${workflowOrders[4].id}`]]) {
    await prisma.notification.upsert({ where: { idempotencyKey: `demo-notification-${user.id}-${title}` }, update: {}, create: { userId: user.id, eventType: "DEMO_ORDER_UPDATE", title, body, deepLink: link, entityType: "Order", entityId: link.split("/").at(-1), idempotencyKey: `demo-notification-${user.id}-${title}` } });
  }
}

async function ensureWarehouse(prisma, name, country, type) {
  const existing = await prisma.warehouse.findFirst({ where: { name, country } });
  return existing ?? prisma.warehouse.create({ data: { name, country, type, address: `Fictional ${country} demo warehouse.` } });
}

async function ensureOrder(prisma, input) {
  const total = input.total;
  const order = await prisma.order.upsert({
    where: { orderNumber: input.number },
    update: { status: input.status, currency: input.currency ?? "BDT", shippingLaneId: input.lane.id, productTotal: total, grandTotal: total, originCountryCode: input.origin, destinationCountryCode: input.destination },
    create: { orderNumber: input.number, customerId: input.customer.id, type: input.type, status: input.status, currency: input.currency ?? "BDT", productTotal: total, grandTotal: total, shippingAddress: { fullName: input.customer.fullName, city: input.destination === "US" ? "New York" : "Dhaka", countryCode: input.destination }, originCountryCode: input.origin, destinationCountryCode: input.destination, shippingLaneId: input.lane.id, items: { create: { productId: input.product.id, productVariantId: input.variant.id, productTitle: input.product.titleEn, variantSnapshot: input.variant.attributes, quantity: 1, unitPrice: total, total } } },
  });
  const histories = await prisma.orderStatusHistory.count({ where: { orderId: order.id } });
  if (!histories) await prisma.orderStatusHistory.create({ data: { orderId: order.id, toStatus: input.status, actorId: input.actorId, note: "Fictional demo workflow status." } });
  return order;
}

async function upsertShippingQuote(prisma, order, lane, createdById, input) {
  return prisma.shippingQuote.upsert({ where: { orderId_version: { orderId: order.id, version: 1 } }, update: { status: input.status, totalBdt: input.total }, create: { orderId: order.id, version: 1, shippingLaneId: lane.id, chargeableWeightGrams: input.weight, declaredWeightGrams: input.weight, discrepancyPercent: "0", discrepancyThresholdPercent: "10", ratePerKgBdt: input.rate, shippingAmountBdt: input.international, lastMileRatePerKgBdt: input.lastMileRate, lastMileDeliveryBdt: input.lastMile, handlingFeeBdt: input.handling, insuranceFeeBdt: input.insurance, totalBdt: input.total, status: input.status, note: input.note, expiresAt: new Date(Date.now() + 7 * 86_400_000), createdById, acceptedAt: input.status === "PAID" ? new Date() : null } });
}

async function ensurePackage(prisma, orderId, packageCode, warehouseId, status, actualWeightGrams, chargeableWeightGrams, inboundTracking) {
  return prisma.package.upsert({ where: { packageCode }, update: { status, warehouseId, actualWeightGrams, chargeableWeightGrams, inboundTracking }, create: { orderId, warehouseId, packageCode, inboundTracking, status, actualWeightGrams, volumetricWeightGrams: chargeableWeightGrams, chargeableWeightGrams, lengthMm: 300, widthMm: 200, heightMm: 120, qcStatus: "PASSED" } });
}

async function ensureShipment(prisma, input) {
  const shipment = await prisma.shipment.upsert({ where: { trackingNumber: input.tracking }, update: { status: input.status }, create: { trackingNumber: input.tracking, status: input.status, carrierName: input.carrier, originWarehouseId: input.originWarehouseId, destinationWarehouseId: input.destinationWarehouseId, shippedAt: new Date(Date.now() - 86_400_000) } });
  await prisma.shipmentPackage.upsert({ where: { shipmentId_packageId: { shipmentId: shipment.id, packageId: input.packageId } }, update: {}, create: { shipmentId: shipment.id, packageId: input.packageId } });
  const eventKey = `demo-shipment-${input.tracking}-${input.status}`;
  await prisma.shipmentEvent.upsert({ where: { idempotencyKey: eventKey }, update: {}, create: { shipmentId: shipment.id, status: input.status, description: input.description, actorId: input.actorId, idempotencyKey: eventKey } });
  return shipment;
}
