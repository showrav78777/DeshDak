type LogLevel = "info" | "warn" | "error";

export type SafeLogContext = {
  requestId?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  errorType?: string;
  digest?: string;
  routerKind?: string;
  routeType?: string;
  outcome?: string;
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

function safeText(value: string, maximumLength = 160) {
  return value.replace(CONTROL_CHARACTERS, "_").slice(0, maximumLength);
}

function safeContext(context: SafeLogContext) {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string") result[key] = safeText(value);
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

/**
 * Writes one JSON object per line. Callers can only pass an allowlisted context;
 * request bodies, cookies, authorization headers, tokens, and raw errors are excluded.
 */
export function logServerEvent(level: LogLevel, event: string, context: SafeLogContext = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "crossly-api",
    event: safeText(event, 100),
    ...safeContext(context),
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}
