import { Prisma, type WalletTransactionType } from "@prisma/client";
import { createReference } from "@/lib/reference";

export class InsufficientWalletBalanceError extends Error {
  constructor() { super("INSUFFICIENT_WALLET_BALANCE"); }
}

export async function ensureWallet(tx: Prisma.TransactionClient, userId: string, currency = "BDT") {
  return tx.wallet.upsert({ where: { userId_currency: { userId, currency } }, update: {}, create: { userId, currency } });
}

type Posting = { userId: string; currency: string; amount: Prisma.Decimal | number | string; direction: "CREDIT" | "DEBIT"; type: WalletTransactionType; idempotencyKey: string; description: string; sourceType: string; sourceId?: string | null; debitAccountCode: string; creditAccountCode: string };

export async function postWalletTransaction(tx: Prisma.TransactionClient, posting: Posting) {
  const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: posting.idempotencyKey } });
  if (existing) return existing;
  const amount = new Prisma.Decimal(posting.amount);
  if (amount.lte(0)) throw new Error("WALLET_AMOUNT_MUST_BE_POSITIVE");
  const wallet = await ensureWallet(tx, posting.userId, posting.currency);
  if (posting.direction === "DEBIT") {
    const result = await tx.wallet.updateMany({ where: { id: wallet.id, availableBalance: { gte: amount } }, data: { availableBalance: { decrement: amount } } });
    if (result.count !== 1) throw new InsufficientWalletBalanceError();
  } else {
    await tx.wallet.update({ where: { id: wallet.id }, data: { availableBalance: { increment: amount } } });
  }
  const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  const balanceBefore = posting.direction === "CREDIT" ? updatedWallet.availableBalance.minus(amount) : updatedWallet.availableBalance.plus(amount);
  const journal = await tx.financialJournal.create({ data: { reference: createReference("JRN"), eventType: posting.sourceType, eventId: posting.sourceId ?? posting.idempotencyKey, currency: posting.currency, description: posting.description, entries: { create: [{ accountCode: posting.debitAccountCode, direction: "DEBIT", amount, currency: posting.currency, memo: posting.description }, { accountCode: posting.creditAccountCode, direction: "CREDIT", amount, currency: posting.currency, memo: posting.description }] } } });
  return tx.walletTransaction.create({ data: { walletId: wallet.id, reference: createReference("WLT"), type: posting.type, amount, currency: posting.currency, balanceBefore, balanceAfter: updatedWallet.availableBalance, description: posting.description, sourceType: posting.sourceType, sourceId: posting.sourceId ?? null, idempotencyKey: posting.idempotencyKey, journalId: journal.id } });
}
