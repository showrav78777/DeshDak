const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type CsrfRequestEvidence = {
  method: string;
  hasBrowserSession: boolean;
  origin: string | null;
  requestOrigin: string;
  fetchSite: string | null;
};

export function isTrustedBrowserMutation(input: CsrfRequestEvidence) {
  if (SAFE_METHODS.has(input.method.toUpperCase()) || !input.hasBrowserSession) return true;
  if (!input.origin || input.origin === "null" || input.fetchSite === "cross-site") return false;

  try {
    return new URL(input.origin).origin === new URL(input.requestOrigin).origin;
  } catch {
    return false;
  }
}
