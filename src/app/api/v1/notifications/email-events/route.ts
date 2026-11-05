import { createHash } from "node:crypto";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { logServerEvent } from "@/lib/observability";
import { applyPendingEmailEvents, emailEventTypes, lockEmailReference } from "@/modules/notifications/email-events";
import { emailWebhookKey, verifyEmailWebhook } from "@/modules/notifications/webhook-signature";

const maximum = 65_536;
const schema = z.object({ type: z.enum(emailEventTypes), created_at: z.iso.datetime({ offset: true }), data: z.object({ email_id: z.string().trim().min(1).max(255) }) });

export async function POST(request: Request) {
  const key = emailWebhookKey();
  if (!key) return apiError("EMAIL_WEBHOOK_UNAVAILABLE", "Email receipt processing is not configured.", 503);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json") || ![null, "identity"].includes(request.headers.get("content-encoding"))) return apiError("UNSUPPORTED_PAYLOAD", "Use an uncompressed JSON payload.", 415);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) return apiError("PAYLOAD_TOO_LARGE", "Callback payload is too large.", 413);
  const reader = request.body?.getReader();
  const chunks: Buffer[] = []; let size = 0;
  try {
    if (reader) for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); return apiError("PAYLOAD_TOO_LARGE", "Callback payload is too large.", 413); }
      chunks.push(Buffer.from(part.value));
    }
  } catch { return apiError("INVALID_PAYLOAD", "Callback body could not be read.", 400); }
  finally { reader?.releaseLock(); }
  const raw = Buffer.concat(chunks);
  const messageId = verifyEmailWebhook(raw, request.headers, key);
  if (!messageId) return apiError("INVALID_WEBHOOK_SIGNATURE", "Callback verification failed.", 401);
  let body;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { return apiError("INVALID_PAYLOAD", "Callback JSON is invalid.", 400); }
  if (!body || typeof body !== "object" || typeof body.type !== "string") return apiError("INVALID_PAYLOAD", "Callback event is invalid.", 400);
  if (!(emailEventTypes as readonly string[]).includes(body.type)) return apiSuccess({ received: true }, { headers: { "Cache-Control": "no-store" } });
  const parsed = schema.safeParse(body);
  if (!parsed.success || Date.parse(parsed.data.created_at) > Date.now() + 300_000) return apiError("INVALID_PAYLOAD", "Callback event is invalid.", 400);
  const hash = createHash("sha256").update(raw).digest("hex");
  try {
    const result = await prisma.$transaction(async tx => {
      await lockEmailReference(tx, parsed.data.data.email_id);
      const existing = await tx.emailWebhookEvent.findUnique({ where: { messageId } });
      if (existing && existing.payloadHash !== hash) return "CONFLICT";
      if (!existing) await tx.emailWebhookEvent.create({ data: { messageId, providerReference: parsed.data.data.email_id, eventType: parsed.data.type, occurredAt: new Date(parsed.data.created_at), payloadHash: hash } });
      await applyPendingEmailEvents(tx, parsed.data.data.email_id);
      return "OK";
    });
    if (result === "CONFLICT") return apiError("WEBHOOK_EVENT_CONFLICT", "Callback identity conflicts with retained evidence.", 409);
    return apiSuccess({ received: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    logServerEvent("error", "notification.email_receipt_failed", { route: "/api/v1/notifications/email-events", method: "POST", status: 503, outcome: "retry_required" });
    return apiError("EMAIL_WEBHOOK_RETRY", "Email receipt processing is temporarily unavailable.", 503);
  }
}
