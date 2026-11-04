import Link from "next/link";
import { PasswordResetConfirmForm } from "@/components/account-recovery-forms";

export default function ResetPasswordPage() { return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">SECURITY CHECK</p><h1>Choose a new account password.</h1><p>After a successful reset, all browser and future mobile sessions for the account are revoked.</p></div></section><section className="seller-login-card-wrap"><PasswordResetConfirmForm /></section></main>; }
