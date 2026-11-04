import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { getCartSummary } from "@/modules/cart/summary";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view your cart.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const cart = await getCartSummary(session.userId);
  return apiSuccess({ cart }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
