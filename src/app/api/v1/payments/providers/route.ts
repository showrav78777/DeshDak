import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { getAvailablePaymentMethods } from "@/modules/payments/availability";

const querySchema = z.object({ country: z.string().trim().length(2).toUpperCase(), baseCurrency: z.string().trim().length(3).toUpperCase().optional(), currency: z.string().trim().length(3).toUpperCase().optional(), amount: z.coerce.number().positive().max(999_999_999) }).refine((value) => Boolean(value.baseCurrency || value.currency), { message: "Base currency is required." });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide a valid destination country, base currency, and amount.", 422);
  const session = await getRequestSession(request);
  const customer = session ? await prisma.user.findUnique({ where: { id: session.userId }, select: { accountType: true } }) : null;
  const baseCurrency = parsed.data.baseCurrency ?? parsed.data.currency!;
  const providers = await getAvailablePaymentMethods(parsed.data.country, baseCurrency, parsed.data.amount, customer?.accountType ?? "PERSONAL");
  return apiSuccess({ providers, destinationCountryCode: parsed.data.country, baseCurrency }, { headers: { "Cache-Control": session ? "private, no-store, max-age=0" : "public, max-age=30, stale-while-revalidate=60", Vary: "Cookie" } });
}
