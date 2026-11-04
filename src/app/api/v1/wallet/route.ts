import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";

const querySchema = z.object({ currency: z.string().trim().length(3).default("BDT"), cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to continue.", 401);
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the wallet filters.", 422);
  const wallet = await prisma.wallet.findUnique({ where: { userId_currency: { userId: session.userId, currency: parsed.data.currency.toUpperCase() } }, include: { transactions: { orderBy: { createdAt: "desc" }, take: parsed.data.limit + 1, ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}), select: { id: true, reference: true, type: true, status: true, amount: true, currency: true, balanceAfter: true, description: true, createdAt: true } } } });
  const rows = wallet?.transactions ?? [];
  const hasMore = rows.length > parsed.data.limit;
  const transactions = hasMore ? rows.slice(0, parsed.data.limit) : rows;
  return apiSuccess({ wallet: { currency: parsed.data.currency.toUpperCase(), availableBalance: wallet?.availableBalance ?? 0, heldBalance: wallet?.heldBalance ?? 0 }, transactions, nextCursor: hasMore ? transactions.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
