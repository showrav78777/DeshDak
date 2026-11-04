import { apiSuccess } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiSuccess(
    { service: "crossly-api", status: "alive", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } },
  );
}
