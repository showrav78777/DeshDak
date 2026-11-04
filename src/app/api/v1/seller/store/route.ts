import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { sellerStoreProfileSchema } from "@/modules/sellers/store-profile-input";

const submissionSchema = sellerStoreProfileSchema.extend({ baseSellerVersion: z.coerce.number().int().positive() });

async function requireSeller(request: NextRequest) {
  const session = await getRequestSession(request);
  if (session?.roles.includes(ROLE.SELLER) && session.portal === "seller") return session;
  if (session?.userId) await prisma.auditLog.create({ data: { actorId: session.userId, action: "seller.store_access_denied", entityType: "SellerProfile", metadata: { portal: session.portal, operation: request.method } } });
  return null;
}

export async function GET(request: NextRequest) {
  const session = await requireSeller(request);
  if (!session) return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const store = await prisma.sellerProfile.findUnique({
    where: { userId: session.userId },
    select: { id: true, storeCode: true, businessName: true, storeSlug: true, storeDescription: true, processingDays: true, originCountryCode: true, shipsInternationally: true, status: true, reviewNote: true, version: true, storeRevisions: { where: { status: "PENDING_REVIEW" }, select: { id: true, status: true, businessName: true, storeDescription: true, processingDays: true, baseSellerVersion: true, submittedAt: true, version: true }, take: 1 } },
  });
  if (!store) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  return apiSuccess({ store }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await requireSeller(request);
  if (!session) return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const parsed = submissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the public store details.", 422, { fields: parsed.error.flatten().fieldErrors });
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { id: true, status: true, version: true, businessName: true, storeDescription: true, processingDays: true } });
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  if (seller.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "Your seller account must remain approved to update its public store.", 403);
  if (seller.version !== parsed.data.baseSellerVersion) return apiError("STORE_VERSION_CONFLICT", "Your store changed in another session. Refresh and try again.", 409);
  if (seller.businessName === parsed.data.businessName && seller.storeDescription === parsed.data.storeDescription && seller.processingDays === parsed.data.processingDays) return apiError("STORE_DETAILS_UNCHANGED", "Change at least one public store detail before submitting.", 422);

  try {
    const revision = await prisma.$transaction(async (tx) => {
      if (await tx.sellerStoreRevision.findFirst({ where: { sellerProfileId: seller.id, status: "PENDING_REVIEW" }, select: { id: true } })) throw new Error("PENDING_STORE_REVISION");
      const created = await tx.sellerStoreRevision.create({ data: { sellerProfileId: seller.id, baseSellerVersion: seller.version, businessName: parsed.data.businessName, storeDescription: parsed.data.storeDescription, processingDays: parsed.data.processingDays }, select: { id: true, status: true, businessName: true, storeDescription: true, processingDays: true, baseSellerVersion: true, submittedAt: true, version: true } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "seller.store_revision_submitted", entityType: "SellerStoreRevision", entityId: created.id, metadata: { sellerProfileId: seller.id, baseSellerVersion: seller.version, changedFields: ["businessName", "storeDescription", "processingDays"] } } });
      return created;
    });
    return apiSuccess({ revision }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "PENDING_STORE_REVISION") return apiError("STORE_REVIEW_ALREADY_PENDING", "Store changes are already awaiting Admin review.", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("STORE_REVIEW_ALREADY_PENDING", "Store changes are already awaiting Admin review.", 409);
    throw error;
  }
}
