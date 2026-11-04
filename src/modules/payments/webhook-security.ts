import { timingSafeEqual } from "crypto";

/** Use only if a gateway's official documentation specifies HMAC-SHA256 signatures. */
export function safeSignatureEqual(expected: string, received: string | null) {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}
