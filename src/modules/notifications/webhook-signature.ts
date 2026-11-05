import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function emailWebhookKey(value = process.env.RESEND_WEBHOOK_SECRET) {
  value = value?.trim();
  if (!value || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const encoded = value.slice(6);
  const key = Buffer.from(encoded, "base64");
  if (key.length < 16 || key.length > 64 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) return null;
  return key;
}

/** Verify the exact bytes; parsing/re-serializing JSON changes the signature. */
export function verifyEmailWebhook(body: Buffer, headers: Headers, key: Buffer, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers.get("svix-id") ?? "";
  const timestamp = headers.get("svix-timestamp") ?? "";
  const signatures = headers.get("svix-signature") ?? "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !/^\d{1,12}$/.test(timestamp) || signatures.length > 2048 || Math.abs(nowSeconds - Number(timestamp)) > 300) return null;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest();
  const valid = signatures.split(/\s+/).some(part => {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(part)) return false;
    const candidate = Buffer.from(part.slice(3), "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  return valid ? id : null;
}
