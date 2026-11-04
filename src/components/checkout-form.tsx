"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

type Address = {
  id?: string;
  label?: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  district: string;
  postalCode?: string | null;
  countryCode?: string;
  isDefault?: boolean;
};
type Destination = { shippingLaneId: string; serviceName: string; transitDaysMin: number | null; transitDaysMax: number | null; country: { isoCode: string; name: string } };

export function CheckoutForm({ cartId, itemCount, subtotal, displayCurrency, initialAddress, savedAddresses, fulfillmentKind, originCountryCode, destinations }: { cartId: string; itemCount: number; subtotal: string; displayCurrency: "BDT" | "USD"; initialAddress: Address; savedAddresses: Address[]; fulfillmentKind: string; originCountryCode: string; destinations: Destination[] }) {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [address, setAddress] = useState(initialAddress);
  const [selectedAddressId, setSelectedAddressId] = useState(initialAddress.id ?? "");
  const isSellerMarketplace = fulfillmentKind === "SELLER_MARKETPLACE";
  const matchingInitialLane = destinations.find((item) => item.country.isoCode === initialAddress.countryCode);
  const [destinationChoice, setDestinationChoice] = useState(isSellerMarketplace && matchingInitialLane ? matchingInitialLane.shippingLaneId : "DOMESTIC");
  const selectedLane = destinations.find((item) => item.shippingLaneId === destinationChoice);
  const countryCode = selectedLane?.country.isoCode ?? (isSellerMarketplace ? originCountryCode : "BD");

  function updateAddress(field: keyof Address, value: string) {
    setAddress((current) => ({ ...current, [field]: value }));
  }

  function chooseSavedAddress(addressId: string) {
    setSelectedAddressId(addressId);
    if (!addressId) {
      setAddress({ label: "Home", fullName: initialAddress.fullName, phone: initialAddress.phone, addressLine1: "", addressLine2: "", city: "", district: "", postalCode: "", countryCode: isSellerMarketplace ? originCountryCode : "BD" });
      setDestinationChoice("DOMESTIC");
      return;
    }
    const saved = savedAddresses.find((item) => item.id === addressId);
    if (!saved) return;
    setAddress(saved);
    const lane = destinations.find((item) => item.country.isoCode === saved.countryCode);
    setDestinationChoice(isSellerMarketplace && lane ? lane.shippingLaneId : "DOMESTIC");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(""); setVerificationRequired(false);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
      body: JSON.stringify({
        cartId,
        saveAddress: !selectedAddressId && values.saveAddress === "on",
        shippingLaneId: selectedLane?.shippingLaneId,
        couponCode: values.couponCode || undefined,
        address: { label: address.label, fullName: address.fullName, phone: address.phone, addressLine1: address.addressLine1, addressLine2: address.addressLine2 || undefined, city: address.city, district: address.district, postalCode: address.postalCode || undefined, countryCode },
      }),
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) { setVerificationRequired(["PHONE_VERIFICATION_REQUIRED", "IDENTITY_VERIFICATION_REQUIRED"].includes(result.error?.code)); return setError(result.error?.message ?? "Unable to create the order."); }
    router.push(`/orders/${result.data.order.id}`);
    router.refresh();
  }

  return <form className="checkout-layout" onSubmit={submit}>
    <section className="checkout-address">
      <p className="eyebrow">DELIVERY ADDRESS</p><h2>Where should we deliver?</h2>
      {savedAddresses.length ? <div className="checkout-saved-address"><label htmlFor="saved-address">Choose a saved address</label><select id="saved-address" value={selectedAddressId} onChange={(event) => chooseSavedAddress(event.target.value)}><option value="">Use a different address</option>{savedAddresses.map((item) => <option key={item.id} value={item.id}>{item.label}{item.isDefault ? " · Default" : ""} · {item.city}, {item.countryCode}</option>)}</select>{selectedAddressId ? <p>Changes below apply only to this order. <Link href="/profile">Edit your saved address book</Link>.</p> : null}</div> : null}
      {isSellerMarketplace ? <><label className="checkout-destination">Destination and delivery service<select name="destinationChoice" value={destinationChoice} onChange={(event) => setDestinationChoice(event.target.value)}><option value="DOMESTIC">{originCountryCode === "BD" ? "Bangladesh" : originCountryCode} · Local seller delivery</option>{destinations.map((destination) => <option key={destination.shippingLaneId} value={destination.shippingLaneId}>{destination.country.name} · {destination.serviceName}{destination.transitDaysMin && destination.transitDaysMax ? ` · ${destination.transitDaysMin}–${destination.transitDaysMax} days` : ""}</option>)}</select></label>{destinationChoice === "DOMESTIC" ? <p className="checkout-domestic-note"><b>Bangladesh local order</b> Your Bangladesh address will create a local seller order. International shipping and export-lane charges do not apply.</p> : null}</> : <div className="checkout-destination-static"><b>Delivery country</b><span>Bangladesh</span></div>}
      <div className="checkout-fields"><label>Address label<input name="label" value={address.label ?? ""} onChange={(event) => updateAddress("label", event.target.value)} required /></label><label>Full name<input name="fullName" value={address.fullName} onChange={(event) => updateAddress("fullName", event.target.value)} required /></label><label>Phone number<input name="phone" type="tel" value={address.phone} onChange={(event) => updateAddress("phone", event.target.value)} required /></label><label className="wide">Address line 1<input name="addressLine1" value={address.addressLine1} onChange={(event) => updateAddress("addressLine1", event.target.value)} required /></label><label className="wide">Address line 2 <span>(optional)</span><input name="addressLine2" value={address.addressLine2 ?? ""} onChange={(event) => updateAddress("addressLine2", event.target.value)} /></label><label>City<input name="city" value={address.city} onChange={(event) => updateAddress("city", event.target.value)} required /></label><label>State, province, or district<input name="district" value={address.district} onChange={(event) => updateAddress("district", event.target.value)} required /></label><label>Postal code <span>(optional)</span><input name="postalCode" value={address.postalCode ?? ""} onChange={(event) => updateAddress("postalCode", event.target.value)} /></label></div>
      {!selectedAddressId ? <label className="checkout-save"><input name="saveAddress" type="checkbox" defaultChecked /> Save this address for future checkout</label> : null}
    </section>
    <aside className="checkout-summary"><p className="eyebrow">CHECKOUT SUMMARY</p><dl><div><dt>Products</dt><dd>{itemCount}</dd></div><div><dt>Product total</dt><dd>{displayCurrency === "USD" ? "$" : "৳"}{Number(subtotal).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div><div><dt>Destination</dt><dd>{selectedLane?.country.name ?? "Bangladesh"}</dd></div><div><dt>Shipping</dt><dd>Confirmed after verified measurement</dd></div></dl><label className="checkout-coupon">Coupon code <span>(optional)</span><input autoCapitalize="characters" maxLength={40} name="couponCode" placeholder="Enter code" /></label><p>Eligible discounts are validated and locked when the order is created. Shipping, inspection, duty, and other approved charges remain separate.</p>{error ? <p className="form-error" role="alert">{error}{verificationRequired ? <> <Link href="/profile">Complete account verification in Profile →</Link></> : null}</p> : null}<button className="button dark" disabled={loading} type="submit">{loading ? "Creating order…" : "Create order & continue to payment"}</button><small>Secure payment happens on the next step. No card, PIN, or gateway password is collected here.</small></aside>
  </form>;
}
