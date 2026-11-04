import { BrandLogo } from "@/components/brand-logo";
import { redirect } from "next/navigation";
import { CustomerLoginForm } from "@/components/customer-auth-forms";
import { getServerSession } from "@/lib/server-session";
import { ROLE } from "@/lib/roles";
import { safeInternalPath } from "@/lib/safe-navigation";
import { googleOauthConfigured } from "@/modules/auth/google-oauth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const [params, session] = await Promise.all([searchParams, getServerSession()]);
  if (session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/dashboard");
  const nextPath = safeInternalPath(params.next, "/dashboard");
  const googleNotice = params.google === "link_required" ? "This email already has a DeshDak account. Sign in with your password first; account linking remains protected." : params.google === "signup_required" ? "This Google account is new to DeshDak. Choose Sign up with Google to create your customer account." : params.google ? "Google sign-in is not available yet. DeshDak must finish its Google OAuth configuration." : "";
  const notice = params.verified === "1" ? "Email verified successfully. You can now sign in." : params.reset === "1" ? "Password reset successfully. Sign in using your new password." : params.signedOut === "1" ? "You have signed out securely." : googleNotice;
  return <main className="seller-login-shell"><section className="seller-login-intro"><BrandLogo /><div><p className="eyebrow">SHOPPING ACCOUNT</p><h1>Everything you need, in one sign-in.</h1><p>Access your cart, orders, tracking, wallet, sourcing requests, and delivery information from one secure customer account.</p></div></section><section className="seller-login-card-wrap"><CustomerLoginForm googleEnabled={googleOauthConfigured()} nextPath={nextPath} notice={notice} /></section></main>;
}
