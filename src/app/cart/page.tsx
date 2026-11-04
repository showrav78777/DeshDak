import { redirect } from "next/navigation";
import { CartManagement } from "@/components/cart-management";
import { CustomerNav } from "@/components/store-header";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { getCartSummary } from "@/modules/cart/summary";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/cart");
  const cart = await getCartSummary(session.userId);
  return <main className="public-catalog cart-page"><CustomerNav session={session} /><section className="cart-content"><p className="eyebrow">YOUR SHOPPING CART</p><div className="cart-title"><div><h1>Review your products.</h1><p>Prices shown here are current catalog prices and will be checked again before payment.</p></div><b>{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}</b></div><CartManagement initialCart={cart} /></section></main>;
}
