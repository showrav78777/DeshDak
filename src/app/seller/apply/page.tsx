import Link from "next/link";
import { SellerOnboardingForm } from "@/components/seller-onboarding-form";

export default function SellerApplyPage() {
  return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">SELL FROM BANGLADESH TO THE WORLD</p><h1>Open your store to international customers.</h1><p>Apply once, submit Bangladesh products after approval, and let DeshDak coordinate delivery through administrator-enabled export destinations.</p></div><div className="seller-login-points"><span>✓ Separate verified seller account</span><span>✓ Public worldwide store page</span><span>✓ Every product reviewed before publishing</span></div></section><section className="seller-login-card-wrap"><SellerOnboardingForm /></section></main>;
}
