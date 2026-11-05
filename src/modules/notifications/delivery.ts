import "server-only";

import { type NotificationDelivery, type Prisma } from "@prisma/client";
import { decryptOutboxPayload, publicApplicationUrl } from "@/lib/security-secrets";
import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 5;
const STALE_SEND_MS = 10 * 60_000;

type SecurePayload = { recipient?: unknown; locale?: unknown; templateKey?: unknown; variables?: unknown };

export function emailDeliveryEnabled() {
  return process.env.EMAIL_DELIVERY_ENABLED === "true" && Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(process.env.EMAIL_FROM?.trim());
}

function text(value: unknown, maximum = 2_000) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum) : "";
}

function retryAt(attempts: number) {
  const minutes = Math.min(6 * 60, 2 ** Math.min(attempts, 8));
  return new Date(Date.now() + minutes * 60_000);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function securePayload(delivery: Pick<NotificationDelivery, "securePayloadCiphertext" | "securePayloadIv" | "securePayloadTag">): SecurePayload | null {
  if (!delivery.securePayloadCiphertext || !delivery.securePayloadIv || !delivery.securePayloadTag) return null;
  try {
    return decryptOutboxPayload({ securePayloadCiphertext: delivery.securePayloadCiphertext, securePayloadIv: delivery.securePayloadIv, securePayloadTag: delivery.securePayloadTag }) as SecurePayload;
  } catch {
    return null;
  }
}

function composeEmail(delivery: { notification: { title: string; body: string; titleBn: string | null; bodyBn: string | null; deepLink: string | null; user: { email: string } } } & Pick<NotificationDelivery, "securePayloadCiphertext" | "securePayloadIv" | "securePayloadTag">) {
  const payload = securePayload(delivery);
  const locale = payload && text(payload.locale, 8) === "bn" ? "bn" : "en";
  const recipient = text(payload?.recipient, 320) || delivery.notification.user.email;
  const title = locale === "bn" && delivery.notification.titleBn ? delivery.notification.titleBn : delivery.notification.title;
  const body = locale === "bn" && delivery.notification.bodyBn ? delivery.notification.bodyBn : delivery.notification.body;
  const variables = payload?.variables && typeof payload.variables === "object" && !Array.isArray(payload.variables) ? payload.variables as Record<string, unknown> : {};
  const actionUrl = text(variables.actionUrl, 2_000);
  const fallbackUrl = delivery.notification.deepLink ? `${publicApplicationUrl()}${delivery.notification.deepLink}` : "";
  const url = actionUrl || fallbackUrl;
  const actionLabel = text(payload?.templateKey, 100).includes("password_reset") ? "Reset password" : text(payload?.templateKey, 100).includes("email_verification") ? "Verify email" : "Open DeshDak";
  const safeUrl = (() => { try { const parsed = new URL(url); return parsed.origin === publicApplicationUrl() && parsed.protocol === "https:" || (process.env.NODE_ENV !== "production" && parsed.origin === publicApplicationUrl()) ? parsed.toString() : ""; } catch { return ""; } })();
  const html = `<main style="font-family:Arial,sans-serif;color:#17354b;line-height:1.55;max-width:620px;margin:auto;padding:24px"><h1 style="font-size:22px">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${safeUrl ? `<p><a href="${escapeHtml(safeUrl)}" style="display:inline-block;background:#103f63;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:bold">${escapeHtml(actionLabel)}</a></p><p style="font-size:12px;color:#657887;overflow-wrap:anywhere">If the button does not work, copy this link: ${escapeHtml(safeUrl)}</p>` : ""}<p style="font-size:12px;color:#657887">This is an automated DeshDak notification. Do not reply with account or payment details.</p></main>`;
  return { recipient, subject: title.slice(0, 180), text: `${title}\n\n${body}${safeUrl ? `\n\n${actionLabel}: ${safeUrl}` : ""}`, html };
}

async function sendWithResend(input: { recipient: string; subject: string; text: string; html: string }, idempotencyKey: string) {
  const response = await fetch("https://api.resend.com/emails", { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [input.recipient], subject: input.subject, text: input.text, html: input.html }), signal: AbortSignal.timeout(12_000) });
  const payload = await response.json().catch(() => null) as { id?: unknown; message?: unknown } | null;
  if (!response.ok || !payload || typeof payload.id !== "string" || !payload.id.trim() || payload.id.length > 255) throw new Error(`Email provider rejected delivery (${response.status}).`);
  return payload.id;
}

export async function runEmailDeliveryWorker({ batchSize = 25 }: { batchSize?: number } = {}) {
  if (!emailDeliveryEnabled()) return { configured: false, processed: 0, accepted: 0, delivered: 0, failed: 0, retried: 0 };
  const now = new Date();
  const staleAt = new Date(now.getTime() - STALE_SEND_MS);
  const eligible = { channel: "EMAIL", providerReference: null, OR: [{ status: "QUEUED", nextAttemptAt: { lte: now } }, { status: "SENT", updatedAt: { lte: staleAt } }] } satisfies Prisma.NotificationDeliveryWhereInput;
  const candidates = await prisma.notificationDelivery.findMany({
    where: eligible,
    include: { notification: { select: { title: true, body: true, titleBn: true, bodyBn: true, deepLink: true, user: { select: { email: true } } } } },
    orderBy: { createdAt: "asc" }, take: Math.min(Math.max(batchSize, 1), 100),
  });
  const result = { configured: true, processed: 0, accepted: 0, delivered: 0, failed: 0, retried: 0 };
  for (const candidate of candidates) {
    if (candidate.attempts >= MAX_ATTEMPTS) {
      const exhausted = await prisma.notificationDelivery.updateMany({ where: { ...eligible, id: candidate.id, attempts: candidate.attempts }, data: { status: "FAILED", failedAt: now, nextAttemptAt: null, lastError: "Email acceptance could not be confirmed after the allowed retry count." } });
      result.processed += exhausted.count; result.failed += exhausted.count;
      continue;
    }
    const claimed = await prisma.notificationDelivery.updateMany({ where: { ...eligible, id: candidate.id, attempts: candidate.attempts }, data: { status: "SENT", attempts: { increment: 1 }, sentAt: now, nextAttemptAt: null, lastError: null } });
    if (claimed.count !== 1) continue;
    result.processed += 1;
    // Fence late completions from a stale worker after another worker reclaims
    // the record. Provider acceptance is not proof of recipient-server delivery.
    const lease = { id: candidate.id, status: "SENT" as const, attempts: candidate.attempts + 1, providerReference: null };
    try {
      const providerReference = await sendWithResend(composeEmail(candidate), candidate.idempotencyKey);
      const accepted = await prisma.notificationDelivery.updateMany({ where: lease, data: { providerReference, lastError: null } });
      result.accepted += accepted.count;
    } catch {
      const attempts = candidate.attempts + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      const failed = await prisma.notificationDelivery.updateMany({ where: lease, data: { status: terminal ? "FAILED" : "QUEUED", failedAt: terminal ? new Date() : null, nextAttemptAt: terminal ? null : retryAt(attempts), lastError: terminal ? "Email delivery failed after the allowed retry count." : "Email provider attempt failed; retry scheduled." } });
      if (terminal) result.failed += failed.count;
      else result.retried += failed.count;
    }
  }
  return result;
}
