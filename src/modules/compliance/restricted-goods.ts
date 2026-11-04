import { createHash } from "node:crypto";
import type { ComplianceScreeningSubject, Prisma, RestrictedGoodsRule } from "@prisma/client";

type ScreeningClient = Prisma.TransactionClient;

export type RestrictedGoodsScreeningInput = {
  subject: ComplianceScreeningSubject;
  subjectReference?: string;
  customerId: string;
  originCountryCode?: string | null;
  destinationCountryCode?: string | null;
  text: Array<string | null | undefined>;
  hsCodes?: Array<string | null | undefined>;
};

type MatchInput = Pick<RestrictedGoodsScreeningInput, "originCountryCode" | "destinationCountryCode" | "text" | "hsCodes">;

function normalizeText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function containsPhrase(haystack: string, phrase: string) {
  const normalized = normalizeText(phrase);
  if (!normalized) return false;
  return ` ${haystack} `.includes(` ${normalized} `);
}

function normalizeHs(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export async function screenRestrictedGoods(tx: ScreeningClient, input: RestrictedGoodsScreeningInput, suppliedRules?: RestrictedGoodsRule[]) {
  const now = new Date();
  const rules = suppliedRules ?? await tx.restrictedGoodsRule.findMany({
    where: {
      status: "ACTIVE",
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      ],
    },
    orderBy: [{ action: "asc" }, { ruleCode: "asc" }],
  });
  const evaluation = matchRestrictedGoodsRules(rules, input);
  const { origin, destination, searchableText, hsCodes, matched, hardBlock, manualReview } = evaluation;
  const policySnapshot = matched.map((rule) => `${rule.ruleCode}:${rule.version}:${rule.action}`).sort();
  const inputHash = createHash("sha256").update(JSON.stringify({ customerId: input.customerId, origin, destination, searchableText, hsCodes: [...hsCodes].sort(), policySnapshot })).digest("hex");
  let outcome: "CLEAR" | "BLOCKED" | "REVIEW_REQUIRED" | "APPROVED" = hardBlock ? "BLOCKED" : manualReview ? "REVIEW_REQUIRED" : "CLEAR";
  if (outcome === "REVIEW_REQUIRED") {
    const approved = await tx.complianceScreeningAttempt.findFirst({ where: { customerId: input.customerId, inputHash, outcome: "APPROVED" }, select: { id: true } });
    if (approved) outcome = "APPROVED";
  }
  const attempt = await tx.complianceScreeningAttempt.create({ data: {
    subject: input.subject,
    subjectReference: input.subjectReference ?? null,
    customerId: input.customerId,
    originCountryCode: origin,
    destinationCountryCode: destination,
    inputHash,
    matchedRuleCodes: matched.map((rule) => rule.ruleCode),
    outcome,
  } });
  return { attempt, allowed: outcome === "CLEAR" || outcome === "APPROVED", outcome, customerMessage: hardBlock?.customerMessage ?? manualReview?.customerMessage ?? null };
}

export function matchRestrictedGoodsRules(rules: RestrictedGoodsRule[], input: MatchInput) {
  const origin = input.originCountryCode?.toUpperCase() ?? null;
  const destination = input.destinationCountryCode?.toUpperCase() ?? null;
  const searchableText = normalizeText(input.text.filter(Boolean).join(" "));
  const hsCodes = (input.hsCodes ?? []).filter((value): value is string => Boolean(value)).map(normalizeHs).filter(Boolean);
  const matched = rules.filter((rule) =>
    (!rule.originCountryCode || rule.originCountryCode === origin)
    && (!rule.destinationCountryCode || rule.destinationCountryCode === destination)
    && (
    rule.keywords.some((keyword) => containsPhrase(searchableText, keyword))
    || rule.hsCodePrefixes.some((prefix) => {
      const normalizedPrefix = normalizeHs(prefix);
      return Boolean(normalizedPrefix) && hsCodes.some((code) => code.startsWith(normalizedPrefix));
    })
    ),
  );
  const hardBlock = matched.find((rule) => rule.action === "BLOCK");
  const manualReview = matched.find((rule) => rule.action === "MANUAL_REVIEW");
  return { origin, destination, searchableText, hsCodes, matched, hardBlock, manualReview };
}

export async function rescreenPublicCatalog(tx: ScreeningClient) {
  const now = new Date();
  const [rules, products] = await Promise.all([
    tx.restrictedGoodsRule.findMany({ where: { status: "ACTIVE", AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] }, { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }] }, orderBy: [{ action: "asc" }, { ruleCode: "asc" }] }),
    tx.product.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, titleEn: true, titleBn: true, shortDescription: true, description: true, brand: true, hsCode: true, originCountryCode: true, category: { select: { nameEn: true, nameBn: true } }, sellerProfile: { select: { userId: true } } } }),
  ]);
  const counts = { clear: 0, blocked: 0, reviewRequired: 0 };
  for (const product of products) {
    const screening = await screenRestrictedGoods(tx, { subject: "PRODUCT_PUBLICATION", subjectReference: product.id, customerId: product.sellerProfile?.userId ?? "SYSTEM", originCountryCode: product.originCountryCode, text: [product.titleEn, product.titleBn, product.shortDescription, product.description, product.brand, product.category?.nameEn, product.category?.nameBn], hsCodes: [product.hsCode] }, rules);
    const complianceStatus = screening.outcome === "BLOCKED" ? "BLOCKED" : screening.outcome === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "CLEAR";
    if (complianceStatus === "BLOCKED") counts.blocked += 1; else if (complianceStatus === "REVIEW_REQUIRED") counts.reviewRequired += 1; else counts.clear += 1;
    await tx.product.update({ where: { id: product.id }, data: { complianceStatus, complianceRuleCodes: screening.attempt.matchedRuleCodes, complianceScreenedAt: now } });
  }
  return counts;
}
