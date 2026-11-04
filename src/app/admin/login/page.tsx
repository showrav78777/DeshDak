import Link from "next/link";
import { AdminLoginForm } from "@/components/admin-login-form";

export default function AdminLoginPage() {
  return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">PLATFORM OPERATIONS</p><h1>Secure access for the team.</h1><p>Review seller applications and manage the operations workflows assigned to your role.</p></div><div className="seller-login-points"><span>✓ Role-controlled access</span><span>✓ Audit log for reviews</span><span>✓ Sensitive data protected</span></div></section><section className="seller-login-card-wrap"><AdminLoginForm /></section></main>;
}
