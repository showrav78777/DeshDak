import { apiSuccess } from "@/lib/api";

export async function GET() {
  return apiSuccess(
    {
      service: "crossly-api",
      status: "ok",
      checks: {
        liveness: "/api/v1/health/live",
        readiness: "/api/v1/health/ready",
      },
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } },
  );
}
