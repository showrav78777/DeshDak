import Link from "next/link";
import { SellerLoginForm } from "@/components/seller-login-form";

export default function SellerLoginPage() {
  return (
    <main className="seller-login-shell">
      <section className="seller-login-intro">
        <Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link>
        <div>
          <p className="eyebrow">BANGLADESH SELLER PORTAL</p>
          <h1>Grow your business with a trusted marketplace.</h1>
          <p>Submit products, manage approvals, and prepare your local catalog for customer orders from one dedicated seller space.</p>
        </div>
        <div className="seller-login-points"><span>✓ Separate seller access</span><span>✓ Product approval workflow</span><span>✓ Built for Bangladesh businesses</span></div>
      </section>
      <section className="seller-login-card-wrap">
        <div><SellerLoginForm /><Link className="back-link" href="/">← Back to customer website</Link></div>
      </section>
    </main>
  );
}
