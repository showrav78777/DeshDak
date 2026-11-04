import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/checkout-form";
import { CustomerNav } from "@/components/store-header";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { getCartSummary } from "@/modules/cart/summary";
import { hasRuntimeReadyPaymentOption } from "@/modules/payments/availability";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/checkout");
  const [cart, addresses, user] = await Promise.all([
    getCartSummary(session.userId),
    prisma.address.findMany({ where: { userId: session.userId, deletedAt: null }, select: { id: true, label: true, fullName: true, phone: true, addressLine1: true, addressLine2: true, city: true, district: true, postalCode: true, countryCode: true, isDefault: true }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }),
    prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { fullName: true, phone: true } }),
  ]);
  if (!cart.id || !cart.items.length) redirect("/cart");
  if (cart.hasUnavailableItems || cart.hasQuoteRequiredItems || cart.fulfillmentKind === "MIXED") redirect("/cart");
  const originCountryCode = cart.items[0]?.product.originCountryCode ?? "CN";
  const destinations = cart.fulfillmentKind === "SELLER_MARKETPLACE" ? await prisma.shippingLane.findMany({
    where: { isActive: true, checkoutEnabled: true, financeApproved: true, complianceApproved: true, operationsApproved: true, originCountry: { is: { isoCode: originCountryCode, isActive: true } }, destinationCountry: { is: { isActive: true } } },
    select: { id: true, name: true, transitDaysMin: true, transitDaysMax: true, destinationCountry: { select: { isoCode: true, name: true, paymentMethods: { where: { checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { customerCurrency: true, paymentMethod: { select: { adapterCode: true } } } } } } },
    orderBy: [{ destinationCountry: { name: "asc" } }, { name: "asc" }],
  }) : [];
  const destinationOptions = (await Promise.all(destinations.map(async (lane) => await hasRuntimeReadyPaymentOption(prisma, lane.destinationCountry.paymentMethods) ? { shippingLaneId: lane.id, serviceName: lane.name, transitDaysMin: lane.transitDaysMin, transitDaysMax: lane.transitDaysMax, country: { isoCode: lane.destinationCountry.isoCode, name: lane.destinationCountry.name } } : null))).filter((lane): lane is NonNullable<typeof lane> => Boolean(lane));
  const eligibleCountryCodes = cart.fulfillmentKind === "SELLER_MARKETPLACE"
    ? new Set([originCountryCode, ...destinationOptions.map((destination) => destination.country.isoCode)])
    : new Set(["BD"]);
  const savedAddresses = addresses.filter((address) => eligibleCountryCodes.has(address.countryCode));
  const defaultAddress = savedAddresses[0];
  const initialAddress = defaultAddress ? {
    ...defaultAddress,
  } : { fullName: user.fullName, phone: user.phone ?? "", addressLine1: "", city: "", district: "", countryCode: cart.fulfillmentKind === "SELLER_MARKETPLACE" ? originCountryCode : "BD" };
  const intro = cart.fulfillmentKind === "SELLER_MARKETPLACE" ? "For a Bangladesh address, choose local seller delivery. For another country, choose an enabled international route. After verified payment, the order enters administrator review and is released to each Bangladesh seller for preparation." : "Review the Bangladesh delivery address. After verified payment and administrator review, sourcing begins.";
  return <main className="dashboard-shell checkout-page"><CustomerNav session={session} /><section className="checkout-content"><p className="eyebrow">SECURE CHECKOUT</p><h1>Confirm your delivery details.</h1><p className="checkout-intro">{intro}</p><CheckoutForm cartId={cart.id} itemCount={cart.itemCount} subtotal={cart.displaySubtotal ?? "0.00"} displayCurrency={cart.displayCurrency} initialAddress={initialAddress} savedAddresses={savedAddresses} fulfillmentKind={cart.fulfillmentKind} originCountryCode={originCountryCode} destinations={destinationOptions} /></section></main>;
}
