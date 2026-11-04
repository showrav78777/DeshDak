import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { getPaymentAdapterOptions } from "@/modules/payments/registry";

const schema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z][A-Za-z0-9_]*$/).transform((value) => value.toUpperCase()),
  displayName: z.string().trim().min(2).max(80),
  kind: z.enum(["MOBILE_WALLET", "CARD", "BANK_TRANSFER", "LOCAL_METHOD", "OTHER"]),
  adapterCode: z.enum(["BKASH", "NAGAD", "SSLCOMMERZ"]),
  settlementCurrency: z.string().trim().length(3).toUpperCase(),
  secretReference: z.string().trim().max(255).refine((value) => !value || value.startsWith("secret://"), "Use a secret:// reference, never a raw credential.").optional(),
});

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const methods = await prisma.paymentMethod.findMany({ include: { countryAvailability: { include: { country: { select: { isoCode: true, name: true } } }, orderBy: { country: { name: "asc" } } } }, orderBy: { displayName: "asc" } });
  return apiSuccess({ methods, adapters: getPaymentAdapterOptions() }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide a valid method, adapter, settlement currency, and secret-manager reference.", 422, z.treeifyError(parsed.error));
  try {
    const method = await prisma.$transaction(async (tx) => {
      const created = await tx.paymentMethod.create({ data: { ...parsed.data, secretReference: parsed.data.secretReference || null, isActive: false } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "payment_method.created", entityType: "PaymentMethod", entityId: created.id, metadata: { code: created.code, adapterCode: created.adapterCode, settlementCurrency: created.settlementCurrency, hasSecretReference: Boolean(created.secretReference) } } });
      return created;
    });
    return apiSuccess({ method }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("PAYMENT_METHOD_EXISTS", "A payment method with this code already exists.", 409);
    throw error;
  }
}
