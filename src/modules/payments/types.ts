export type PaymentProvider = "BKASH" | "NAGAD" | "SSLCOMMERZ" | "OTHER";

export type CreatePaymentInput = { reference: string; amount: string; currency: string; callbackUrl: string; idempotencyKey: string };
export type GatewayCheckout = { redirectUrl: string; providerTransactionId: string };

/** Gateway adapters must tokenize/redirect; this application never collects card PAN, CVV, or PIN. */
export interface PaymentGatewayAdapter {
  provider: PaymentProvider;
  createCheckout(input: CreatePaymentInput): Promise<GatewayCheckout>;
  verifyWebhook(rawBody: string, signature: string | null): Promise<{ valid: boolean; eventId?: string; payload: Record<string, unknown> }>;
}
