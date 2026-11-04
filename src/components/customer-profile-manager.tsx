"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useClientReady } from "@/components/use-client-ready";

type Profile = {
  personCode: string;
  fullName: string;
  email: string;
  phone: string | null;
  residenceCountryCode: string;
  locale: string;
  accountType: string;
  preferredCurrency: string;
  kycStatus: string;
  status: string;
};

type Address = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  district: string;
  postalCode: string | null;
  countryCode: string;
  isDefault: boolean;
};

type CountryOption = { isoCode: string; name: string };

function addressPayload(form: HTMLFormElement) {
  const values = Object.fromEntries(new FormData(form));
  return {
    label: values.label,
    fullName: values.fullName,
    phone: values.phone,
    addressLine1: values.addressLine1,
    addressLine2: values.addressLine2 || "",
    city: values.city,
    district: values.district,
    postalCode: values.postalCode || "",
    countryCode: values.countryCode,
  };
}

function AddressFields({ address, countries, disabled }: { address?: Address; countries: CountryOption[]; disabled: boolean }) {
  return <div className="profile-address-fields"><label>Address label<input disabled={disabled} name="label" defaultValue={address?.label ?? "Home"} minLength={2} maxLength={50} required /></label><label>Recipient name<input disabled={disabled} name="fullName" defaultValue={address?.fullName ?? ""} minLength={2} maxLength={120} required /></label><label>Phone number<input disabled={disabled} name="phone" type="tel" defaultValue={address?.phone ?? ""} minLength={8} maxLength={24} required /></label><label>Country<select disabled={disabled} name="countryCode" defaultValue={address?.countryCode ?? "BD"}>{countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name} ({country.isoCode})</option>)}</select></label><label className="wide">Address line 1<input disabled={disabled} name="addressLine1" defaultValue={address?.addressLine1 ?? ""} minLength={5} maxLength={250} required /></label><label className="wide">Address line 2 <span>(optional)</span><input disabled={disabled} name="addressLine2" defaultValue={address?.addressLine2 ?? ""} maxLength={250} /></label><label>City<input disabled={disabled} name="city" defaultValue={address?.city ?? ""} minLength={2} maxLength={100} required /></label><label>State, province, or district<input disabled={disabled} name="district" defaultValue={address?.district ?? ""} minLength={2} maxLength={100} required /></label><label>Postal code <span>(optional)</span><input disabled={disabled} name="postalCode" defaultValue={address?.postalCode ?? ""} maxLength={20} /></label></div>;
}

export function CustomerProfileManager({ profile, addresses, countries, currencies }: { profile: Profile; addresses: Address[]; countries: CountryOption[]; currencies: string[] }) {
  const router = useRouter();
  const ready = useClientReady();
  const pending = useRef(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [addressMessage, setAddressMessage] = useState("");
  const [profileError, setProfileError] = useState(false);
  const [addressError, setAddressError] = useState(false);
  const [saving, setSaving] = useState(false);

  type SavedData = { user?: Partial<Profile>; address?: Partial<Address>; removedAddressId?: string };
  async function save(target: "profile" | "address", path: string, method: string, payload: object | undefined, confirmed: (data: SavedData) => boolean, success: string) {
    if (!ready || pending.current) return false;
    pending.current = true; setSaving(true);
    const setMessage = target === "profile" ? setProfileMessage : setAddressMessage;
    const setError = target === "profile" ? setProfileError : setAddressError;
    setMessage(""); setError(false);
    try {
      const response = await fetch(path, { method, credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}) });
      const result = await response.json();
      if (!response.ok) { setError(true); setMessage(typeof result?.error?.message === "string" ? result.error.message : "Could not save this change."); return false; }
      if (!result?.data || !confirmed(result.data)) throw new Error("Unconfirmed profile change");
      setMessage(success);
      return true;
    } catch {
      setError(true); setMessage("Could not confirm this change. Reload and check your saved details before retrying. Your entered details are kept.");
      return false;
    } finally { pending.current = false; setSaving(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = { fullName: values.fullName, phone: values.phone, residenceCountryCode: values.residenceCountryCode, locale: values.locale, preferredCurrency: values.preferredCurrency, accountType: values.accountType };
    if (await save("profile", "/api/v1/users/me", "PATCH", payload, data => data.user?.fullName === String(values.fullName).trim() && data.user.phone === String(values.phone).replace(/[\s()-]/g, "") && data.user.residenceCountryCode === values.residenceCountryCode && data.user.locale === values.locale && data.user.preferredCurrency === values.preferredCurrency && data.user.accountType === values.accountType, "Profile saved securely.")) router.refresh();
  }

  async function createAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = { ...addressPayload(form), isDefault: new FormData(form).get("isDefault") === "on" };
    if (await save("address", "/api/v1/users/me/addresses", "POST", payload, data => typeof data.address?.id === "string" && data.address.label === String(payload.label).trim() && data.address.addressLine1 === String(payload.addressLine1).trim(), "Address added.")) { form.reset(); router.refresh(); }
  }

  async function updateAddress(event: FormEvent<HTMLFormElement>, addressId: string) {
    event.preventDefault();
    const payload = addressPayload(event.currentTarget);
    if (await save("address", `/api/v1/users/me/addresses/${addressId}`, "PATCH", payload, data => data.address?.id === addressId && data.address.label === String(payload.label).trim() && data.address.addressLine1 === String(payload.addressLine1).trim(), "Address updated.")) router.refresh();
  }

  async function addressAction(addressId: string, action: "default" | "delete") {
    if (!ready || pending.current) return;
    if (action === "delete" && !window.confirm("Remove this saved delivery address?")) return;
    if (await save("address", `/api/v1/users/me/addresses/${addressId}`, action === "delete" ? "DELETE" : "PATCH", action === "delete" ? undefined : { isDefault: true }, data => action === "delete" ? data.removedAddressId === addressId : data.address?.id === addressId && data.address.isDefault === true, action === "delete" ? "Address removed." : "Default address changed.")) router.refresh();
  }

  return <div className="profile-manager" aria-busy={saving}>{!ready ? <p>Enable JavaScript to save profile or address changes. No change has been submitted.</p> : null}<section className="profile-panel"><div className="profile-panel-head"><div><p className="eyebrow">ACCOUNT DETAILS</p><h2>Personal and business preferences</h2></div><span>{profile.status.replaceAll("_", " ")}</span></div><div className="profile-identity"><div><small>Customer ID</small><b>{profile.personCode}</b></div><div><small>Email address</small><b>{profile.email}</b><span>Email changes require a separate verified security workflow.</span></div><div><small>Customer market</small><b>{profile.residenceCountryCode === "BD" ? "Bangladesh" : "International"}</b><span>{profile.residenceCountryCode}</span></div><div><small>Identity verification</small><b>{profile.kycStatus.replaceAll("_", " ")}</b></div></div><form method="post" className="profile-form" onSubmit={saveProfile}><label>Full name<input disabled={!ready || saving} name="fullName" defaultValue={profile.fullName} minLength={2} maxLength={120} required /></label><label>Phone number<input disabled={!ready || saving} name="phone" type="tel" defaultValue={profile.phone ?? ""} pattern="\+[1-9][0-9 ()-]{7,20}" required /></label><label>Country of residence<select disabled={!ready || saving} name="residenceCountryCode" defaultValue={profile.residenceCountryCode} required>{countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name} ({country.isoCode})</option>)}</select></label><label>Language<select disabled={!ready || saving} name="locale" defaultValue={profile.locale}><option value="en">English</option><option value="bn">বাংলা</option></select></label><label>Account type<select disabled={!ready || saving} name="accountType" defaultValue={profile.accountType}><option value="PERSONAL">Personal</option><option value="BUSINESS">Business</option></select></label><label>Preferred currency<select disabled={!ready || saving} name="preferredCurrency" defaultValue={profile.preferredCurrency}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Saving…" : "Save profile"}</button>{profileMessage ? <p className={profileError ? "form-error" : "form-success"} role={profileError ? "alert" : "status"}>{profileMessage}</p> : null}</form></section><section className="profile-panel address-book"><div className="profile-panel-head"><div><p className="eyebrow">DELIVERY ADDRESS BOOK</p><h2>Saved addresses</h2></div><span>{addresses.length} saved</span></div>{addressMessage ? <p className={addressError ? "form-error" : "form-success"} role={addressError ? "alert" : "status"}>{addressMessage}</p> : null}{addresses.length ? <div className="profile-address-list">{addresses.map((address) => <article key={address.id}><div className="profile-address-title"><div><b>{address.label}</b>{address.isDefault ? <span>Default</span> : null}</div><small>{address.countryCode}</small></div><address><b>{address.fullName} · {address.phone}</b><span>{address.addressLine1}{address.addressLine2 ? `, ${address.addressLine2}` : ""}</span><span>{address.city}, {address.district}{address.postalCode ? ` ${address.postalCode}` : ""}</span></address><div className="profile-address-actions">{!address.isDefault ? <button disabled={!ready || saving} type="button" onClick={() => addressAction(address.id, "default")}>Make default</button> : null}<details inert={!ready}><summary>Edit</summary><form method="post" onSubmit={(event) => updateAddress(event, address.id)}><AddressFields disabled={!ready || saving} address={address} countries={countries} /><button className="button primary" disabled={!ready || saving} type="submit">Save address</button></form></details><button className="danger" disabled={!ready || saving} type="button" onClick={() => addressAction(address.id, "delete")}>Remove</button></div></article>)}</div> : <div className="profile-address-empty"><b>No saved address yet</b><p>Add one below or save an address during checkout.</p></div>}<details inert={!ready} className="new-address" open={!addresses.length}><summary>+ Add delivery address</summary><form method="post" onSubmit={createAddress}><AddressFields disabled={!ready || saving} countries={countries} /><label className="profile-default-check"><input disabled={!ready || saving} name="isDefault" type="checkbox" /> Use as my default address</label><button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Saving…" : "Add address"}</button></form></details></section></div>;
}
