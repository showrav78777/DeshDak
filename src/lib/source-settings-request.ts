/** Same-origin Admin configuration only; never accepts supplier keys or endpoints. */
export async function saveSourceSettings(path: string, method: "POST" | "PATCH", payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!/^\/api\/v1\/admin\/(?:source-platforms(?:\/[a-zA-Z0-9-]+(?:\/accounts)?)?|integration-accounts\/[a-zA-Z0-9-]+)$/.test(path)) {
    throw new Error("Invalid configuration destination.");
  }
  if ("secretReference" in payload && (typeof payload.secretReference !== "string" || !/^secret:\/\/[A-Za-z0-9_./-]{3,240}$/.test(payload.secretReference))) {
    throw new Error("Enter a secret:// reference, not an API key. Store the real credential in your secret manager.");
  }
  const uncertain = "Save could not be confirmed. Refresh this page before trying again; your change may already have been saved.";
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = (async () => {
      const response = await fetchImpl(path, {
        method, credentials: "same-origin", redirect: "error", cache: "no-store",
        signal: controller.signal, headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401 || response.status === 403) throw new Error("Your Admin session needs verification. Sign in again and complete MFA.");
      if (response.status === 409) throw new Error("Settings conflict or activation is locked. Refresh and review the source/account before trying again.");
      if (response.status === 422) throw new Error("Check the country, secret reference, limits and expiry date. Only secret:// references are accepted, not API keys.");
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error(uncertain);
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || Array.isArray(result) || !("data" in result) || "error" in result) throw new Error(uncertain);
    })();
    await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error(uncertain)); }, 15_000);
    })]);
  } catch (error) {
    const safeMessages = [uncertain, "Your Admin session needs verification. Sign in again and complete MFA.", "Settings conflict or activation is locked. Refresh and review the source/account before trying again.", "Check the country, secret reference, limits and expiry date. Only secret:// references are accepted, not API keys."];
    throw new Error(error instanceof Error && safeMessages.includes(error.message) ? error.message : uncertain);
  } finally {
    clearTimeout(timeout);
  }
}
