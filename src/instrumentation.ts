import type { Instrumentation } from "next";

import { logServerEvent } from "@/lib/observability";
import { isValidRequestId } from "@/lib/request-id";

export function register() {
  logServerEvent("info", "server.started", { outcome: process.env.NEXT_RUNTIME ?? "unknown" });
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const requestIdHeader = request.headers["x-request-id"];
  const requestIdCandidate = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
  const digestCandidate = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;

  logServerEvent("error", "request.unhandled_error", {
    requestId: isValidRequestId(requestIdCandidate) ? requestIdCandidate : undefined,
    route: context.routePath,
    method: request.method,
    errorType: error instanceof Error ? error.name : "UnknownError",
    digest: digestCandidate,
    routerKind: context.routerKind,
    routeType: context.routeType,
    outcome: "failed",
  });
};
