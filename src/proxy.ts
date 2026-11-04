import { NextResponse, type NextRequest } from "next/server";

import { isTrustedBrowserMutation } from "@/lib/csrf";
import { isValidRequestId } from "@/lib/request-id";

const NO_INDEX_ROUTES = [
  "/api", "/admin", "/warehouse", "/logistics", "/inspector", "/support",
  "/dashboard", "/orders", "/wallet", "/cart", "/checkout", "/notifications",
  "/security", "/rmas", "/scan", "/print", "/login", "/register",
  "/forgot-password", "/reset-password", "/verify-email", "/buy-ship", "/ship-for-me", "/sales",
  "/seller/login", "/seller/dashboard", "/seller/orders", "/seller/products",
] as const;

const PRIVATE_PAGE_ROUTES = [
  "/admin", "/warehouse", "/logistics", "/inspector", "/support",
  "/dashboard", "/orders", "/wallet", "/cart", "/checkout", "/notifications",
  "/security", "/rmas", "/scan", "/print", "/profile", "/wishlist",
  "/buy-ship", "/ship-for-me", "/seller/dashboard", "/seller/orders",
  "/seller/products", "/seller/store", "/seller/integrations", "/finance",
  "/compliance", "/sourcing", "/sales",
] as const;

const AUTH_FORM_ROUTES = [
  "/login", "/register", "/verify-email", "/forgot-password", "/reset-password",
  "/admin/login", "/admin/setup", "/seller/login", "/warehouse/login",
  "/inspector/login", "/logistics/login", "/support/login", "/compliance/login",
  "/finance/login", "/sourcing/login", "/sales/login",
] as const;

const SENSITIVE_AUTH_QUERY_FIELDS = ["email", "password", "confirmPassword", "phone", "setupToken"] as const;

function mustNotBeIndexed(pathname: string) {
  return NO_INDEX_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function isPrivatePage(pathname: string) {
  return PRIVATE_PAGE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function proxy(request: NextRequest) {
  const suppliedRequestId = request.headers.get("x-request-id");
  const requestId = isValidRequestId(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
  const isAuthForm = AUTH_FORM_ROUTES.some((route) => request.nextUrl.pathname === route);
  const hasSensitiveAuthQuery = request.method === "GET" && isAuthForm && SENSITIVE_AUTH_QUERY_FIELDS.some((field) => request.nextUrl.searchParams.has(field));
  const originalHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const requestHostname = originalHost?.split(":")[0]?.toLowerCase();
  const usesLoopbackAlias = process.env.NODE_ENV !== "production" && requestHostname === "127.0.0.1";
  if (hasSensitiveAuthQuery || usesLoopbackAlias) {
    const safeUrl = new URL(request.url);
    if (isAuthForm) SENSITIVE_AUTH_QUERY_FIELDS.forEach((field) => safeUrl.searchParams.delete(field));
    if (usesLoopbackAlias) {
      const port = originalHost?.split(":")[1];
      const canonicalUrl = `http://localhost${port ? `:${port}` : ""}${safeUrl.pathname}${safeUrl.search}${safeUrl.hash}`;
      return new Response(null, { status: 307, headers: { Location: canonicalUrl, "x-request-id": requestId } });
    }
    return NextResponse.redirect(safeUrl, 307);
  }
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-request-id", requestId);

  const hasBrowserSession = request.cookies.has("crossly_session") || request.cookies.has("__Host-crossly_session");
  const trustedMutation = isTrustedBrowserMutation({
    method: request.method,
    hasBrowserSession,
    origin: request.headers.get("origin"),
    requestOrigin: request.nextUrl.origin,
    fetchSite: request.headers.get("sec-fetch-site"),
  });
  if (request.nextUrl.pathname.startsWith("/api/v1/") && !trustedMutation) {
    return NextResponse.json(
      { error: { code: "UNTRUSTED_ORIGIN", message: "This signed-in action must originate from the DeshDak application." } },
      { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "x-request-id": requestId } },
    );
  }

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set("x-request-id", requestId);
  if (mustNotBeIndexed(request.nextUrl.pathname)) response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (isPrivatePage(request.nextUrl.pathname)) response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
