const STAFF_PORTAL_PREFIXES = ["/admin", "/seller", "/warehouse", "/logistics", "/inspector", "/finance", "/compliance", "/sourcing", "/sales"];

export function hidesCustomerChrome(pathname: string) {
  return STAFF_PORTAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    || pathname.startsWith("/support/login")
    || pathname.startsWith("/support/tickets")
    || pathname.startsWith("/print")
    || pathname.startsWith("/scan");
}
