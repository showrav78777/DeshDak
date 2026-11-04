import Link from "next/link";
import { EmailVerificationConfirmForm, EmailVerificationRequestForm } from "@/components/account-recovery-forms";

export default function VerifyEmailPage() { return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">PROTECT YOUR ACCOUNT</p><h1>Verify your email before signing in.</h1><p>This confirms that security alerts, password recovery, and important order updates reach the account owner.</p></div></section><section className="seller-login-card-wrap"><div><EmailVerificationConfirmForm /><EmailVerificationRequestForm /></div></section></main>; }
