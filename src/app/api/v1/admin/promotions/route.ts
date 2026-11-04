import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const optionalMoney = z.union([z.literal(""), z.coerce.number().positive().max(99_999_999)]).optional();
const optionalLimit = z.union([z.literal(""), z.coerce.number().int().positive().max(1_000_000)]).optional();
const createSchema = z.object({
  name: z.string().trim().min(3).max(100),
  internalDescription: z.string().trim().max(500).optional(),
  customerMessage: z.string().trim().min(3).max(180),
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  discountValue: z.coerce.number().positive().max(99_999_999),
  minimumOrderAmount: z.coerce.number().min(0).max(99_999_999).default(0),
  maximumDiscount: optionalMoney,
  totalUsageLimit: optionalLimit,
  perCustomerLimit: z.coerce.number().int().positive().max(1_000).default(1),
  perDayLimit: optionalLimit,
  eligibleAccountType: z.union([z.enum(["PERSONAL", "BUSINESS"]), z.literal("")]).optional(),
  firstOrderOnly: z.boolean().default(false),
  allowsCouponStacking: z.boolean().default(false),
  priority: z.coerce.number().int().min(-1_000).max(1_000).default(0),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}).superRefine((value, context) => {
  if (value.endsAt <= value.startsAt) context.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be after the start time." });
  if (value.discountType === "PERCENTAGE" && value.discountValue > 100) context.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discounts cannot exceed 100%." });
});

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const promotions = await prisma.automaticPromotion.findMany({ include: { _count: { select: { applications: true } } }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }] });
  return apiSuccess({ promotions }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the automatic promotion rules and validity window.", 422, z.treeifyError(parsed.error));
  const data = parsed.data;
  const promotion = await prisma.$transaction(async (tx) => {
    const created = await tx.automaticPromotion.create({ data: {
      name: data.name,
      internalDescription: data.internalDescription || null,
      customerMessage: data.customerMessage,
      discountType: data.discountType,
      discountValue: new Prisma.Decimal(data.discountValue),
      minimumOrderAmount: new Prisma.Decimal(data.minimumOrderAmount),
      maximumDiscount: data.maximumDiscount === "" || data.maximumDiscount === undefined ? null : new Prisma.Decimal(data.maximumDiscount),
      totalUsageLimit: data.totalUsageLimit === "" || data.totalUsageLimit === undefined ? null : data.totalUsageLimit,
      perCustomerLimit: data.perCustomerLimit,
      perDayLimit: data.perDayLimit === "" || data.perDayLimit === undefined ? null : data.perDayLimit,
      eligibleAccountType: data.eligibleAccountType || null,
      firstOrderOnly: data.firstOrderOnly,
      allowsCouponStacking: data.allowsCouponStacking,
      priority: data.priority,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      status: "DRAFT",
    } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "automatic_promotion.created", entityType: "AutomaticPromotion", entityId: created.id, metadata: { name: created.name, discountType: created.discountType, discountValue: created.discountValue.toFixed(2), priority: created.priority, allowsCouponStacking: created.allowsCouponStacking, startsAt: created.startsAt.toISOString(), endsAt: created.endsAt.toISOString() } } });
    return created;
  });
  return apiSuccess({ promotion }, { status: 201 });
}
