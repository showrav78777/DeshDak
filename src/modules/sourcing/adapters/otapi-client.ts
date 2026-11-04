import { createHash } from "node:crypto";

// Internal transport only. Never return these provider payloads through a public API.
type Credentials = { instanceKey: string; signatureSecret?: string };
type Method = "SearchItemsFrame" | "GetItemFullInfo";
type Options = {
  approved: boolean;
  resolveCredentials: () => Promise<Credentials>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class SupplierApiError extends Error {
  readonly code: "DISABLED" | "INVALID_INPUT" | "UNAVAILABLE" | "INVALID_RESPONSE" | "PROVIDER_REJECTED";
  constructor(code: SupplierApiError["code"]) {
    super(`Supplier request failed: ${code}`);
    this.code = code;
    this.name = "SupplierApiError";
  }
}

/** OTAPI's documented algorithm signs unencoded values sorted by parameter name. */
export function signOtapiParameters(method: string, parameters: Record<string, string>, secret: string): string {
  const values = Object.keys(parameters).filter((key) => key !== "signature").sort().map((key) => parameters[key]).join("");
  return createHash("sha256").update(method + values + secret, "utf8").digest("hex");
}

function text(value: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new SupplierApiError("INVALID_INPUT");
  }
  return value.trim();
}

function xml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function language(value: string): string {
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)) throw new SupplierApiError("INVALID_INPUT");
  return value;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new SupplierApiError("UNAVAILABLE"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    if (signal.aborted) aborted();
  });
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const limit = 2 * 1024 * 1024;
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) {
    throw new SupplierApiError("INVALID_RESPONSE");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await abortable(reader.read(), signal);
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        throw new SupplierApiError("INVALID_RESPONSE");
      }
      chunks.push(next.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new SupplierApiError("INVALID_RESPONSE");
    }
  } finally {
    // Cancellation must not itself hold the request open on a stalled upstream.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Read-only, fixed-host connector; deliberately not wired into the live registry. */
export function createOtapiClient(options: Options) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw new SupplierApiError("INVALID_INPUT");
  async function request(method: Method, parameters: Record<string, string>): Promise<Record<string, unknown>> {
    if (options.approved !== true) throw new SupplierApiError("DISABLED");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const credentials = await abortable(options.resolveCredentials(), controller.signal);
      // Validate credentials without changing their bytes before signing.
      text(credentials.instanceKey, 512);
      const fields = { ...parameters, instanceKey: credentials.instanceKey } as Record<string, string>;
      if (credentials.signatureSecret !== undefined) {
        text(credentials.signatureSecret, 1024);
        const secret = credentials.signatureSecret;
        fields.timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        fields.signature = signOtapiParameters(method, fields, secret);
      }
      // POST keeps credentials out of URLs. Never follow a redirect with credentials.
      const response = await abortable((options.fetchImpl ?? fetch)(`https://otapi.net/service-json/${method}`, {
        method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(fields).toString(),
      }), controller.signal);
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw new SupplierApiError("UNAVAILABLE");
      }
      const payload = await boundedJson(response, controller.signal);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new SupplierApiError("INVALID_RESPONSE");
      const envelope = payload as Record<string, unknown>;
      if (typeof envelope.ErrorCode !== "string") throw new SupplierApiError("INVALID_RESPONSE");
      if (envelope.ErrorCode !== "Ok") throw new SupplierApiError("PROVIDER_REJECTED");
      if (!envelope.Result || typeof envelope.Result !== "object" || Array.isArray(envelope.Result)) throw new SupplierApiError("INVALID_RESPONSE");
      return envelope.Result as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SupplierApiError) throw error;
      // Do not attach causes: upstream errors can contain URLs, tokens or payloads.
      throw new SupplierApiError("UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    search(input: { query: string; provider: string; page: number; pageSize: number; language?: string }) {
      if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1000 || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50) {
        throw new SupplierApiError("INVALID_INPUT");
      }
      return request("SearchItemsFrame", {
        language: language(input.language ?? "en"),
        xmlParameters: `<SearchItemsParameters><ItemTitle>${xml(text(input.query, 200))}</ItemTitle><Provider>${xml(text(input.provider, 100))}</Provider></SearchItemsParameters>`,
        framePosition: String((input.page - 1) * input.pageSize), frameSize: String(input.pageSize),
      });
    },
    getProductDetail(input: { itemId: string; language?: string }) {
      return request("GetItemFullInfo", {
        language: language(input.language ?? "en"), itemId: text(input.itemId, 200),
        itemParameters: "",
      });
    },
  };
}
