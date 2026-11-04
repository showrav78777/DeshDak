import { apiSuccess } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  // Dynamic environment lookup avoids build-time NEXT_PUBLIC replacement.
  // Only the deliberately public site key may cross this boundary.
  const environment = process.env;
  return apiSuccess({ siteKey: environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null }, { headers: { "Cache-Control": "no-store" } });
}
