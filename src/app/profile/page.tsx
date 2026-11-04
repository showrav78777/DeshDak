import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerProfileManager } from "@/components/customer-profile-manager";
import { CustomerNav } from "@/components/store-header";
import { PrivacyAnalyticsControl } from "@/components/privacy-analytics-control";
import { IdentityVerificationPanel } from "@/components/identity-verification-panel";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My profile", robots: { index: false, follow: false } };

export default async function CustomerProfilePage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/profile");
  const [profile, addresses, activeCountries] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { personCode: true, fullName: true, email: true, phone: true, phoneVerifiedAt: true, residenceCountryCode: true, locale: true, accountType: true, preferredCurrency: true, kycStatus: true, status: true, analyticsConsent: true, analyticsConsentAt: true } }),
    prisma.address.findMany({ where: { userId: session.userId, deletedAt: null }, select: { id: true, label: true, fullName: true, phone: true, addressLine1: true, addressLine2: true, city: true, district: true, postalCode: true, countryCode: true, isDefault: true }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }),
    prisma.country.findMany({ where: { isActive: true }, select: { isoCode: true, name: true, defaultCurrency: true }, orderBy: { name: "asc" } }),

  ]);
  const countryNames = new Map<string, string>([["BD", "Bangladesh"], [profile.residenceCountryCode, profile.residenceCountryCode], ...activeCountries.map(({ isoCode, name }) => [isoCode, name] as const), ...addresses.map(({ countryCode }) => [countryCode, countryCode] as const)]);
  const countries = [...countryNames].map(([isoCode, name]) => ({ isoCode, name })).sort((left, right) => left.name.localeCompare(right.name));
  const currencies = [...new Set(["BDT", profile.preferredCurrency, ...activeCountries.map((country) => country.defaultCurrency)])].sort();
  const identitySubmissions = await prisma.identityVerification.findMany({ where: { userId: session.userId }, select: { id: true, documentType: true, issuingCountryCode: true, documentNumberLast4: true, status: true, submittedAt: true, reviewedAt: true, reviewNote: true }, orderBy: { submittedAt: "desc" }, take: 10 });
  return <main className="dashboard-shell profile-page"><CustomerNav session={session} /><section className="profile-content"><div className="profile-page-head"><p className="eyebrow">MY PROFILE</p><h1>Account and delivery details.</h1><p>Manage the information DeshDak uses for your account and checkout. Sensitive changes remain protected and auditable.</p></div><IdentityVerificationPanel phone={profile.phone} phoneVerifiedAt={profile.phoneVerifiedAt} kycStatus={profile.kycStatus} submissions={identitySubmissions} residenceCountryCode={profile.residenceCountryCode} /><CustomerProfileManager profile={profile} addresses={addresses} countries={countries} currencies={currencies} /><PrivacyAnalyticsControl enabled={profile.analyticsConsent} recordedAt={profile.analyticsConsentAt?.toISOString() ?? null} /></section></main>;
}
