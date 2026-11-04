import Link from "next/link";
import { PasswordResetRequestForm } from "@/components/account-recovery-forms";

export default function ForgotPasswordPage() { return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">SECURE ACCOUNT RECOVERY</p><h1>Recover access without exposing your account.</h1><p>Reset links are short-lived, single-use, and delivered only through the verified email channel. Privileged staff accounts require an administrator-controlled recovery process.</p></div></section><section className="seller-login-card-wrap"><PasswordResetRequestForm /></section></main>; }
