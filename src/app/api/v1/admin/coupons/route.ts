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
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(500).optional(),
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  discountValue: z.coerce.number().positive().max(99_999_999),
  minimumOrderAmount: z.coerce.number().min(0).max(99_999_999).default(0),
  maximumDiscount: optionalMoney,
  totalUsageLimit: optionalLimit,
  perCustomerLimit: z.coerce.number().int().positive().max(1_000).default(1),
  perDayLimit: optionalLimit,
  eligibleAccountType: z.union([z.enum(["PERSONAL", "BUSINESS"]), z.literal("")]).optional(),
  firstOrderOnly: z.boolean().default(false),
  allowsAutomaticStacking: z.boolean().default(false),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}).superRefine((value, context) => {
  if (value.endsAt <= value.startsAt) context.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be after the start time." });
  if (value.discountType === "PERCENTAGE" && value.discountValue > 100) context.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discounts cannot exceed 100%." });
});

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const coupons = await prisma.coupon.findMany({ include: { _count: { select: { redemptions: true } } }, orderBy: { createdAt: "desc" } });
  return apiSuccess({ coupons }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the coupon rules and validity window.", 422, z.treeifyError(parsed.error));
  const data = parsed.data;
  try {
    const coupon = await prisma.$transaction(async (tx) => {
      const created = await tx.coupon.create({ data: {
        code: data.code,
        name: data.name,
        description: data.description || null,
        discountType: data.discountType,
        discountValue: new Prisma.Decimal(data.discountValue),
        minimumOrderAmount: new Prisma.Decimal(data.minimumOrderAmount),
        maximumDiscount: data.maximumDiscount === "" || data.maximumDiscount === undefined ? null : new Prisma.Decimal(data.maximumDiscount),
        totalUsageLimit: data.totalUsageLimit === "" || data.totalUsageLimit === undefined ? null : data.totalUsageLimit,
        perCustomerLimit: data.perCustomerLimit,
        perDayLimit: data.perDayLimit === "" || data.perDayLimit === undefined ? null : data.perDayLimit,
        eligibleAccountType: data.eligibleAccountType || null,
        firstOrderOnly: data.firstOrderOnly,
        allowsAutomaticStacking: data.allowsAutomaticStacking,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        status: "DRAFT",
      } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "coupon.created", entityType: "Coupon", entityId: created.id, metadata: { code: created.code, discountType: created.discountType, discountValue: created.discountValue.toFixed(2), startsAt: created.startsAt.toISOString(), endsAt: created.endsAt.toISOString() } } });
      return created;
    });
    return apiSuccess({ coupon }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("COUPON_CODE_EXISTS", "A coupon with this code already exists.", 409);
    throw error;
  }
}
