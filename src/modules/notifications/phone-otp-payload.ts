import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { decryptOutboxPayload, encryptOutboxPayload, hashPhoneVerificationCode, type EncryptedOutboxPayload } from "@/lib/security-secrets";

const MAX_PAYLOAD_BYTES = 4096;
export class PhoneOtpPayloadError extends Error {
  constructor() { super("PHONE_OTP_DISPATCH_DENIED"); }
}

type Binding = { userId: string; sessionId: string; tokenId: string; phone: string; tokenHash: string; expiresAt: Date };
/** Must be read from authoritative rows under the account/session/token locks. */
export type PhoneOtpDispatchContext = Binding & {
  accountActive: boolean; sessionActive: boolean; phoneVerified: boolean; tokenUsed: boolean;
};
type Payload = { version: 1; userId: string; sessionId: string; tokenId: string; phone: string; code: string; expiresAt: string; clientReference: string };
function identifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function validBinding(value: Binding) {
  return value && identifier(value.userId) && identifier(value.sessionId) && identifier(value.tokenId)
    && typeof value.phone === "string" && /^\+8801[3-9]\d{8}$/.test(value.phone)
    && typeof value.tokenHash === "string" && /^[a-f0-9]{64}$/.test(value.tokenHash)
    && value.expiresAt instanceof Date && Number.isFinite(value.expiresAt.getTime());
}
function matchesHash(binding: Binding, code: string) {
  return timingSafeEqual(Buffer.from(binding.tokenHash, "hex"), Buffer.from(hashPhoneVerificationCode(binding.userId, binding.phone, code), "hex"));
}
function validLifetime(expiresAt: Date) {
  const remaining = expiresAt.getTime() - Date.now();
  return remaining > 15_000 && remaining <= 605_000;
}

/** Call inside the token-issuance transaction, then persist only these encrypted fields. */
export function sealPhoneOtpPayload(binding: Binding, code: string): EncryptedOutboxPayload {
  try {
    if (!validBinding(binding) || typeof code !== "string" || !/^\d{6}$/.test(code) || !validLifetime(binding.expiresAt) || !matchesHash(binding, code)) throw new PhoneOtpPayloadError();
    const payload: Payload = { version: 1, userId: binding.userId, sessionId: binding.sessionId, tokenId: binding.tokenId, phone: binding.phone, code, expiresAt: binding.expiresAt.toISOString(), clientReference: randomBytes(10).toString("hex") };
    return encryptOutboxPayload(payload);
  } catch { throw new PhoneOtpPayloadError(); }
}

/**
 * A preflight check, not an authorization/claim mechanism. The future worker must
 * obtain authoritative locked context and a durable one-attempt claim before I/O.
 * Never expose the decrypted return value through an API, audit event or log.
 */
export function openPhoneOtpForDispatch(encrypted: EncryptedOutboxPayload, context: PhoneOtpDispatchContext) {
  try {
    if (!validBinding(context) || context.accountActive !== true || context.sessionActive !== true || context.phoneVerified !== false || context.tokenUsed !== false || !validLifetime(context.expiresAt)) throw new PhoneOtpPayloadError();
    // Bound ciphertext before decoding to prevent oversized/corrupt queue records.
    if (!encrypted || typeof encrypted.securePayloadCiphertext !== "string" || encrypted.securePayloadCiphertext.length > MAX_PAYLOAD_BYTES || typeof encrypted.securePayloadIv !== "string" || encrypted.securePayloadIv.length !== 16 || typeof encrypted.securePayloadTag !== "string" || encrypted.securePayloadTag.length !== 24) throw new PhoneOtpPayloadError();
    const payload = decryptOutboxPayload(encrypted);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.version !== 1
      || payload.userId !== context.userId || payload.sessionId !== context.sessionId || payload.tokenId !== context.tokenId || payload.phone !== context.phone || payload.expiresAt !== context.expiresAt.toISOString()
      || typeof payload.code !== "string" || !/^\d{6}$/.test(payload.code) || typeof payload.clientReference !== "string" || !/^[a-f0-9]{20}$/.test(payload.clientReference) || !matchesHash(context, payload.code)) throw new PhoneOtpPayloadError();
    // Expiry is deliberately rechecked after decrypting/revalidating the record.
    if (!validLifetime(context.expiresAt)) throw new PhoneOtpPayloadError();
    return { recipient: context.phone, code: payload.code, clientReference: payload.clientReference, expiresAt: new Date(context.expiresAt) };
  } catch { throw new PhoneOtpPayloadError(); }
}
