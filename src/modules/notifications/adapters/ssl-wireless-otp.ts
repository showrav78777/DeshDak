import "server-only";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const ENDPOINT = "https://smsplus.sslwireless.com/api/v3/secure/otp-sms";
const DEADLINE_MS = 12_000;
const MAX_RESPONSE_BYTES = 8_192;
type Configuration = { apiToken: string; secretKey: string; senderId: string; approved: boolean };
type Input = { recipient: string; code: string; clientReference: string; expiresAt: Date };
type Dependencies = { transport?: typeof fetch; randomIv?: () => Buffer };
export class SmsTransportError extends Error {
  constructor(code: "SMS_APPROVAL_REQUIRED" | "SMS_CONFIGURATION_INVALID" | "SMS_INPUT_INVALID" | "SMS_SUBMISSION_UNCONFIRMED") { super(code); }
}
function formEncode(value: string) {
  // Match PHP http_build_query's RFC1738 encoding, including base64 + / =.
  return encodeURIComponent(value).replace(/[!'()*~]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");
}
function canonical(fields: Record<string, string>) {
  return Object.keys(fields).sort().map(key => `${formEncode(key)}=${formEncode(fields[key])}`).join("&");
}
function gatewayNumber(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.startsWith("+") ? value.slice(1) : value.startsWith("01") ? `88${value}` : value;
  return /^8801[3-9]\d{8}$/.test(normalized) ? normalized : null;
}
function secret(value: unknown) {
  return typeof value === "string" && value.length >= 16 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(value);
}

/** Protocol transport only. No worker, environment switch or customer route activates it. */
export function createSslWirelessOtpTransport(config: Configuration, dependencies: Dependencies = {}) {
  if (!config || typeof config !== "object") throw new SmsTransportError("SMS_CONFIGURATION_INVALID");
  if (config.approved !== true) throw new SmsTransportError("SMS_APPROVAL_REQUIRED");
  if (!secret(config.apiToken) || !secret(config.secretKey) || config.apiToken === config.secretKey || typeof config.senderId !== "string" || !/^[A-Za-z0-9]{1,20}$/.test(config.senderId)) throw new SmsTransportError("SMS_CONFIGURATION_INVALID");
  const { apiToken, secretKey, senderId } = config;
  const transport = dependencies.transport ?? fetch;
  const randomIv = dependencies.randomIv ?? (() => randomBytes(16));
  return { submitOtp: async (input: Input) => {
    if (!input || typeof input !== "object") throw new SmsTransportError("SMS_INPUT_INVALID");
    const recipient = gatewayNumber(input.recipient);
    // Require the application's canonical country format; accept alternate forms only in gateway echoes.
    if (!recipient || input.recipient !== `+${recipient}` || typeof input.code !== "string" || !/^\d{6}$/.test(input.code) || typeof input.clientReference !== "string" || !/^[A-Za-z0-9]{1,20}$/.test(input.clientReference) || !(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now() + 15_000 || input.expiresAt.getTime() > Date.now() + 605_000) throw new SmsTransportError("SMS_INPUT_INVALID");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEADLINE_MS);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let responseBody: ReadableStream<Uint8Array> | null = null;
    let removeAbort: (() => void) | undefined;
    try {
      const iv = randomIv();
      if (!Buffer.isBuffer(iv) || iv.length !== 16) throw new Error("Invalid IV");
      // The vendor protocol uses the first 32 ASCII hex characters of SHA-256,
      // then base64 ciphertext inside an IV-prefixed outer base64 envelope.
      const key = Buffer.from(createHash("sha256").update(secretKey).digest("hex").slice(0, 32), "utf8");
      const cipher = createCipheriv("aes-256-cbc", key, iv);
      const text = `Your DeshDak verification code is ${input.code}. Do not share this code.`;
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
      const sms = Buffer.concat([iv, Buffer.from(encrypted, "ascii")]).toString("base64");
      const fields = { sid: senderId, msisdn: recipient, sms, csms_id: input.clientReference };
      const signature = createHmac("sha256", secretKey).update(canonical(fields)).digest("hex");
      const aborted = new Promise<never>((_, reject) => {
        const abort = () => reject(new Error("Aborted"));
        controller.signal.addEventListener("abort", abort, { once: true }); removeAbort = () => controller.signal.removeEventListener("abort", abort);
      });
      // Exactly one attempt. The caller must reconcile uncertain sends, never blindly retry them.
      const response = await Promise.race([transport(ENDPOINT, {
        method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "identity", "X-Signature": signature },
        body: JSON.stringify({ api_token: apiToken, ...fields }),
      }), aborted]);
      responseBody = response.body;
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") || ![null, "identity"].includes(response.headers.get("content-encoding")) || !response.body) throw new Error("Unconfirmed submission");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw new Error("Unconfirmed length");
      reader = response.body.getReader();
      if (controller.signal.aborted) throw new Error("Aborted");

      const chunks: Buffer[] = []; let bytes = 0;
      for (;;) {
        const part = await Promise.race([reader.read(), aborted]); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) throw new Error("Response too large");
        chunks.push(Buffer.from(part.value));
      }
      const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      const item = Array.isArray(payload?.smsinfo) && payload.smsinfo.length === 1 ? payload.smsinfo[0] : null;
      if (payload?.status !== "SUCCESS" || payload.status_code !== 200 || item?.sms_status !== "SUCCESS" || gatewayNumber(item.msisdn) !== recipient || item.csms_id !== input.clientReference || typeof item.reference_id !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(item.reference_id)) throw new Error("Unconfirmed acknowledgement");
      return { state: "ACCEPTED" as const, clientReference: input.clientReference, providerReference: item.reference_id };
    } catch { throw new SmsTransportError("SMS_SUBMISSION_UNCONFIRMED"); }
    finally {
      clearTimeout(timeout); removeAbort?.(); controller.abort();
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      else { void responseBody?.cancel().catch(() => {}); }
    }
  } };
}
