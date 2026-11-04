import { apiSuccess } from "@/lib/api";
import { logServerEvent } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { requestIdFromHeaders } from "@/lib/request-id";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };

export async function GET(request: Request) {
  const startedAt = performance.now();
  const requestId = requestIdFromHeaders(request.headers);

  try {
    await prisma.$queryRaw`SELECT 1`;
    return apiSuccess(
      { service: "crossly-api", status: "ready", dependencies: { database: "ready" }, timestamp: new Date().toISOString() },
      { headers: responseHeaders },
    );
  } catch (error) {
    logServerEvent("error", "health.readiness_failed", {
      requestId,
      route: "/api/v1/health/ready",
      method: "GET",
      status: 503,
      durationMs: Math.round(performance.now() - startedAt),
      errorType: error instanceof Error ? error.name : "UnknownError",
      outcome: "not_ready",
    });
    return apiSuccess(
      { service: "crossly-api", status: "not_ready", dependencies: { database: "unavailable" }, timestamp: new Date().toISOString() },
      { status: 503, headers: responseHeaders },
    );
  }
}
