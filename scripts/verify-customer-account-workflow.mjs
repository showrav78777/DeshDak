import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for customer-account verification.");
const marker = randomBytes(8).toString("hex");
const phoneSuffix = BigInt(`0x${marker}`).toString().padStart(9, "0").slice(-9);
const ids = { users: [], sessions: [], addresses: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal: "customer", clientName: "Customer account verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000) } });
  ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: ["customer_personal"] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function call(path, { cookie, method = "GET", body, trustedOrigin = true } = {}) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(trustedOrigin && method !== "GET" ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

const address = (label, suffix = "1") => ({ label, fullName: `Recipient ${marker}`, phone: `01700${marker.slice(0, 6)}`, addressLine1: `${suffix} Verification Road`, city: "Dhaka", district: "Dhaka", postalCode: "1205", countryCode: "bd" });

try {
  const customerRole = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } });
  async function customer(label) {
    const user = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: customerRole.id } } } });
    ids.users.push(user.id);
    return user;
  }
  const owner = await customer("account-owner");
  const foreign = await customer("account-foreign");
  const [ownerCookie, foreignCookie] = await Promise.all([sessionFor(owner), sessionFor(foreign)]);

  assert((await call("/api/v1/users/me")).response.status === 401, "Anonymous visitor accessed a private customer profile.");
  const profile = await call("/api/v1/users/me", { cookie: ownerCookie });
  assert(profile.response.status === 200 && profile.body.data.user.id === owner.id && profile.body.data.user.fullName === owner.fullName, "Customer profile retrieval failed.");
  assert(!("passwordHash" in profile.body.data.user) && !("userId" in profile.body.data.session), "Customer profile exposed an internal credential or ownership field.");

  const profileUpdate = { fullName: "Updated Owner", phone: `+8801${phoneSuffix}`, residenceCountryCode: "BD", locale: "bn", preferredCurrency: "USD", accountType: "BUSINESS" };
  const untrustedProfile = await call("/api/v1/users/me", { cookie: ownerCookie, method: "PATCH", trustedOrigin: false, body: profileUpdate });
  assert(untrustedProfile.response.status === 403 && untrustedProfile.body.error.code === "UNTRUSTED_ORIGIN", "Profile mutation accepted an untrusted browser origin.");
  const updatedProfile = await call("/api/v1/users/me", { cookie: ownerCookie, method: "PATCH", body: profileUpdate });
  assert(updatedProfile.response.status === 200 && updatedProfile.body.data.user.fullName === "Updated Owner" && updatedProfile.body.data.user.preferredCurrency === "USD" && updatedProfile.body.data.user.residenceCountryCode === "BD" && updatedProfile.body.data.user.accountType === "BUSINESS", `Customer profile update failed: ${JSON.stringify(updatedProfile.body)}`);
  const customerRoles = await prisma.userRole.findMany({ where: { userId: owner.id }, include: { role: true } });
  const customerRoleCodes = new Set(customerRoles.map(({ role }) => role.code));
  assert(customerRoleCodes.has("customer_personal") && customerRoleCodes.has("customer_business"), "Business classification removed common customer access or omitted the Business role.");

  const privacy = await call("/api/v1/users/me/privacy", { cookie: ownerCookie });
  assert(privacy.response.status === 200 && privacy.body.data.privacy.analyticsConsent === false, "Privacy settings retrieval failed.");
  const updatedPrivacy = await call("/api/v1/users/me/privacy", { cookie: ownerCookie, method: "PATCH", body: { analyticsConsent: true } });
  assert(updatedPrivacy.response.status === 200 && updatedPrivacy.body.data.privacy.analyticsConsent === true && updatedPrivacy.body.data.privacy.analyticsConsentAt, "Privacy consent update failed.");

  const first = await call("/api/v1/users/me/addresses", { cookie: ownerCookie, method: "POST", body: address("Home") });
  assert(first.response.status === 201 && first.body.data.address.isDefault === true && first.body.data.address.countryCode === "BD", `First address was not normalized and made default: ${JSON.stringify(first.body)}`);
  assert(!("userId" in first.body.data.address) && !("deletedAt" in first.body.data.address), "Address response exposed internal ownership or deletion fields.");
  ids.addresses.push(first.body.data.address.id);
  const second = await call("/api/v1/users/me/addresses", { cookie: ownerCookie, method: "POST", body: address("Office", "2") });
  assert(second.response.status === 201 && second.body.data.address.isDefault === false, "Second address unexpectedly replaced the default.");
  ids.addresses.push(second.body.data.address.id);
  const profilePage = await call("/profile", { cookie: ownerCookie });
  assert(profilePage.response.status === 200 && typeof profilePage.body === "string" && profilePage.body.includes("Account and delivery details.") && profilePage.body.includes("Home") && profilePage.body.includes("Office"), "Customer profile/address web page did not render owned account data.");

  assert((await call(`/api/v1/users/me/addresses/${first.body.data.address.id}`, { cookie: foreignCookie, method: "PATCH", body: { label: "Stolen" } })).response.status === 404, "Another customer changed an owned address.");
  assert((await call(`/api/v1/users/me/addresses/${first.body.data.address.id}`, { cookie: foreignCookie, method: "DELETE" })).response.status === 404, "Another customer removed an owned address.");

  const promoted = await call(`/api/v1/users/me/addresses/${second.body.data.address.id}`, { cookie: ownerCookie, method: "PATCH", body: { label: "Main office", isDefault: true } });
  assert(promoted.response.status === 200 && promoted.body.data.address.label === "Main office" && promoted.body.data.address.isDefault === true, "Address edit/default switch failed.");
  const cannotUnset = await call(`/api/v1/users/me/addresses/${second.body.data.address.id}`, { cookie: ownerCookie, method: "PATCH", body: { isDefault: false } });
  assert(cannotUnset.response.status === 409 && cannotUnset.body.error.code === "DEFAULT_ADDRESS_REQUIRED", "The active default could be unset without a replacement.");

  const removedDefault = await call(`/api/v1/users/me/addresses/${second.body.data.address.id}`, { cookie: ownerCookie, method: "DELETE" });
  assert(removedDefault.response.status === 200 && removedDefault.body.data.newDefaultAddressId === first.body.data.address.id, "Deleting the default did not promote the remaining address.");
  const list = await call("/api/v1/users/me/addresses", { cookie: ownerCookie });
  assert(list.response.status === 200 && list.body.data.addresses.length === 1 && list.body.data.addresses[0].id === first.body.data.address.id && list.body.data.addresses[0].isDefault === true, "Address list did not hide the deleted address or preserve one default.");
  const removedLast = await call(`/api/v1/users/me/addresses/${first.body.data.address.id}`, { cookie: ownerCookie, method: "DELETE" });
  assert(removedLast.response.status === 200 && removedLast.body.data.newDefaultAddressId === null, "Deleting the last address returned an invalid replacement.");
  assert((await call("/api/v1/users/me/addresses", { cookie: ownerCookie })).body.data.addresses.length === 0, "Soft-deleted addresses remained visible.");
  assert(await prisma.address.count({ where: { id: { in: ids.addresses }, deletedAt: { not: null } } }) === 2, "Address deletion was not recoverable soft deletion.");

  console.log("Customer account verification passed: private profile, Business classification, common customer access, trusted mutations, consent, address ownership, safe DTOs, default integrity, and recoverable deletion.");
} finally {
  if (ids.users.length) {
    await prisma.userEvent.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
  }
  if (ids.addresses.length) await prisma.address.deleteMany({ where: { id: { in: ids.addresses } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) {
    await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
  await prisma.$disconnect();
}
