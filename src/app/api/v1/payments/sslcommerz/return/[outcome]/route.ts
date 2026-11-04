import { NextResponse, type NextRequest } from "next/server";
import { publicApplicationUrl } from "@/lib/security-secrets";

const outcomes = new Set(["success", "fail", "cancel"]);

async function processReturnedTransaction(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  const submitted = contentType.includes("application/x-www-form-urlencoded")
    ? new URLSearchParams(await request.text())
    : request.nextUrl.searchParams;
  const transactionId = submitted.get("tran_id")?.trim();
  const validationId = submitted.get("val_id")?.trim();
  if (!transactionId || !validationId) return "processing";

  // SSLCommerz cannot reach localhost during sandbox development. Replaying only
  // the two signed-provider references through our IPN processor is safe because
  // it always validates the transaction directly with SSLCommerz before mutation.
  const ipnUrl = new URL("/api/v1/payments/sslcommerz/ipn", publicApplicationUrl());
  try {
    const response = await fetch(ipnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-store" },
      body: new URLSearchParams({ tran_id: transactionId, val_id: validationId }).toString(),
      cache: "no-store",
    });
    const result = await response.text();
    return response.ok && (result === "OK" || result === "HELD") ? "success" : "processing";
  } catch {
    return "processing";
  }
}

async function returnToDUAR(request: NextRequest, context: { params: Promise<{ outcome: string }> }) {
  const { outcome } = await context.params;
  const safeOutcome = outcomes.has(outcome) ? outcome : "unknown";
  const destination = new URL("/orders", publicApplicationUrl());
  const processed = safeOutcome === "success" ? await processReturnedTransaction(request) : safeOutcome;
  destination.searchParams.set("payment", processed);
  return NextResponse.redirect(destination, { status: 303, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export const GET = returnToDUAR;
export const POST = returnToDUAR;
