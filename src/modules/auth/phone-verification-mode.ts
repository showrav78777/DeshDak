import "server-only";

// No live SMS sender is implemented. Credentials alone must never activate it.
// The explicit local test path is unavailable in production, even with the flag.
export function getPhoneVerificationMode(env: Record<string, string | undefined> = process.env): "DEVELOPMENT_ONLY" | "UNAVAILABLE" {
  return (env.NODE_ENV === "development" || env.NODE_ENV === "test") && env.ALLOW_DEV_AUTH_LINKS === "true"
    ? "DEVELOPMENT_ONLY"
    : "UNAVAILABLE";
}
