import bcrypt from "bcryptjs";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { verifyHuman } from "@/lib/human-verification";
import { newPasswordSchema } from "@/modules/auth/password";
import { issueSecurityToken } from "@/modules/auth/security-token-service";

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(160),
  storeSlug: z.string().trim().toLowerCase().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  storeDescription: z.string().trim().min(20).max(1000),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(8).max(24),
  password: newPasswordSchema,
  tradeLicenseNo: z.string().trim().max(80).optional(),
  nidOrTin: z.string().trim().max(80).optional(),
  businessAddress: z.string().trim().min(10).max(500),
  processingDays: z.coerce.number().int().min(1).max(30),
  shipsInternationally: z.preprocess((value) => value === true || value === "on", z.boolean()),
  humanVerificationToken: z.string().max(2048).optional(),
  "cf-turnstile-response": z.string().max(2048).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the seller onboarding details.", 422, z.treeifyError(parsed.error));
  if (!(await verifyHuman(request, parsed.data.humanVerificationToken ?? parsed.data["cf-turnstile-response"], "seller_onboarding"))) return apiError("HUMAN_VERIFICATION_FAILED", "Please complete human verification and try again.", 403);
  const role = await prisma.role.upsert({ where: { code: ROLE.SELLER }, update: {}, create: { code: ROLE.SELLER, description: "Bangladesh local seller" } });
  const { password, ...seller } = parsed.data;
  try {
    const profile = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { fullName: seller.fullName, email: seller.email, phone: seller.phone, passwordHash: await bcrypt.hash(password, 12), status: "PENDING_VERIFICATION", roles: { create: { roleId: role.id } } } });
      await issueSecurityToken(tx, { id: user.id, email: user.email, locale: user.locale }, "EMAIL_VERIFICATION");
      return tx.sellerProfile.create({
        data: {
          userId: user.id,
          businessName: seller.businessName,
          storeSlug: seller.storeSlug,
          storeDescription: seller.storeDescription,
          businessAddress: seller.businessAddress,
          tradeLicenseNo: seller.tradeLicenseNo || null,
          nidOrTin: seller.nidOrTin || null,
          originCountryCode: "BD",
          shipsInternationally: seller.shipsInternationally,
          processingDays: seller.processingDays,
          status: "PENDING_REVIEW",
        },
        select: { id: true, businessName: true, storeSlug: true, status: true, createdAt: true },
      });
    });
    return apiSuccess({ sellerProfile: profile, nextAction: "VERIFY_EMAIL", message: "Your application is awaiting review. Verify your email before signing in." }, { status: 201, headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (isUniqueConstraint(error)) return apiError("SELLER_IDENTITY_IN_USE", "That email, phone number, or store web address is already in use.", 409);
    throw error;
  }
}

function isUniqueConstraint(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
