import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export type EncryptedSecret = { secretCiphertext: string; secretIv: string; secretTag: string };

function encryptionKey() {
  const configured = process.env.MFA_ENCRYPTION_KEY;
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    return decoded;
  }
  if (process.env.NODE_ENV === "production") throw new Error("MFA_ENCRYPTION_KEY is required in production.");
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret === "replace-with-a-long-random-secret") throw new Error("AUTH_SECRET is not configured.");
  return createHash("sha256").update(`crossly:mfa:development:${authSecret}`).digest();
}

function base32Encode(input: Buffer) {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    output += BASE32_ALPHABET[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, "0"), 2)];
  }
  return output;
}

function base32Decode(input: string) {
  let bits = "";
  for (const character of input.toUpperCase().replace(/=|\s|-/g, "")) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function encryptMfaSecret(secret: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { secretCiphertext: ciphertext.toString("base64"), secretIv: iv.toString("base64"), secretTag: cipher.getAuthTag().toString("base64") };
}

export function decryptMfaSecret(value: EncryptedSecret) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.secretIv, "base64"));
  decipher.setAuthTag(Buffer.from(value.secretTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.secretCiphertext, "base64")), decipher.final()]).toString("utf8");
}

function totpAtStep(secret: string, step: bigint) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function verifyTotp(secret: string, rawCode: string, now = Date.now()) {
  const code = rawCode.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = BigInt(Math.floor(now / 1000 / TOTP_PERIOD_SECONDS));
  for (const drift of [BigInt(-1), BigInt(0), BigInt(1)]) {
    const step = currentStep + drift;
    const expected = Buffer.from(totpAtStep(secret, step));
    const supplied = Buffer.from(code);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return step;
  }
  return null;
}

export function totpUri(secret: string, email: string) {
  const issuer = "DeshDak";
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const value = randomBytes(8).toString("hex").toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`;
  });
}

export function normalizeRecoveryCode(value: string) {
  return value.toUpperCase().replace(/[^A-F0-9]/g, "");
}

export function hashRecoveryCode(value: string) {
  return createHmac("sha256", encryptionKey()).update(`crossly:recovery:${normalizeRecoveryCode(value)}`).digest("hex");
}
