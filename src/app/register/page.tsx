import { BrandLogo } from "@/components/brand-logo";
import { CustomerRegistrationForm } from "@/components/customer-auth-forms";
import { WORLD_COUNTRIES } from "@/lib/world-countries";
import { googleOauthConfigured } from "@/modules/auth/google-oauth";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const params = await searchParams;
  const notice = params.google ? "Google sign-up is not available yet. DeshDak must finish its Google OAuth configuration." : "";
  return <main className="seller-login-shell"><section className="seller-login-intro"><BrandLogo /><div><p className="eyebrow">GLOBAL CUSTOMER ACCESS</p><h1>Your cross-border shopping account.</h1><p>Create one secure account for sourcing, purchases, tracking, and delivery. Available checkout routes depend on the countries DeshDak enables.</p></div></section><section className="seller-login-card-wrap"><CustomerRegistrationForm countries={WORLD_COUNTRIES} googleEnabled={googleOauthConfigured()} notice={notice} /></section></main>;
}
