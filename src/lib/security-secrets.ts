import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import type { SecurityTokenPurpose } from "@prisma/client";

export type EncryptedOutboxPayload = { securePayloadCiphertext: string; securePayloadIv: string; securePayloadTag: string };

function authSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value === "replace-with-a-long-random-secret") throw new Error("AUTH_SECRET is not configured.");
  return value;
}

function outboxEncryptionKey() {
  const configured = process.env.AUTH_OUTBOX_ENCRYPTION_KEY;
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== 32) throw new Error("AUTH_OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    return decoded;
  }
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_OUTBOX_ENCRYPTION_KEY is required in production.");
  return createHash("sha256").update(`crossly:auth-outbox:development:${authSecret()}`).digest();
}

export function generateSecurityToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSecurityToken(purpose: SecurityTokenPurpose, token: string) {
  return createHmac("sha256", authSecret()).update(`crossly:${purpose}:${token}`).digest("hex");
}

export function hashRateLimitKey(scope: string, value: string) {
  return createHmac("sha256", authSecret()).update(`crossly:rate-limit:${scope}:${value}`).digest("hex");
}

export function encryptOutboxPayload(payload: Record<string, unknown>): EncryptedOutboxPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", outboxEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { securePayloadCiphertext: ciphertext.toString("base64"), securePayloadIv: iv.toString("base64"), securePayloadTag: cipher.getAuthTag().toString("base64") };
}

/** Decrypt only inside a trusted server-side delivery worker. Never return this payload from an API. */
export function decryptOutboxPayload(payload: EncryptedOutboxPayload) {
  const decipher = createDecipheriv("aes-256-gcm", outboxEncryptionKey(), Buffer.from(payload.securePayloadIv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.securePayloadTag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.securePayloadCiphertext, "base64")), decipher.final()]).toString("utf8")) as Record<string, unknown>;
}

export function publicApplicationUrl() {
  const raw = process.env.APP_BASE_URL ?? process.env.AUTH_ISSUER ?? "http://localhost:3000";
  const url = new URL(raw);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("APP_BASE_URL must use HTTPS in production.");
  return url.origin;
}
