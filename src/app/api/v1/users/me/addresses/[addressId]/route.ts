import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";

const updateSchema = z.object({
  label: z.string().trim().min(2).max(50).optional(),
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(8).max(24).optional(),
  addressLine1: z.string().trim().min(5).max(250).optional(),
  addressLine2: z.string().trim().max(250).nullable().optional(),
  city: z.string().trim().min(2).max(100).optional(),
  district: z.string().trim().min(2).max(100).optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  isDefault: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one address field is required." });

const addressSelect = {
  id: true, label: true, fullName: true, phone: true, addressLine1: true,
  addressLine2: true, city: true, district: true, postalCode: true,
  countryCode: true, isDefault: true,
} as const;

function isPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ addressId: string }> }) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to update an address.", 401);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the delivery address.", 422, z.treeifyError(parsed.error));
  const { addressId } = await params;

  try {
    const address = await prisma.$transaction(async (tx) => {
      const current = await tx.address.findFirst({ where: { id: addressId, userId: session.userId, deletedAt: null }, select: { id: true, isDefault: true } });
      if (!current) return null;
      if (current.isDefault && parsed.data.isDefault === false) throw new Error("DEFAULT_ADDRESS_REQUIRED");
      if (parsed.data.isDefault === true) {
        await tx.address.updateMany({ where: { userId: session.userId, deletedAt: null, isDefault: true, id: { not: addressId } }, data: { isDefault: false } });
      }
      const updated = await tx.address.update({
        where: { id: addressId },
        data: {
          ...parsed.data,
          ...(parsed.data.addressLine2 !== undefined ? { addressLine2: parsed.data.addressLine2 || null } : {}),
          ...(parsed.data.postalCode !== undefined ? { postalCode: parsed.data.postalCode || null } : {}),
        },
        select: addressSelect,
      });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "address.updated", entityType: "Address", entityId: updated.id, metadata: { fields: Object.keys(parsed.data), isDefault: updated.isDefault } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!address) return apiError("ADDRESS_NOT_FOUND", "The saved address was not found.", 404);
    return apiSuccess({ address }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "DEFAULT_ADDRESS_REQUIRED") return apiError("DEFAULT_ADDRESS_REQUIRED", "Choose another default address before removing this default.", 409);
    if (isPrismaError(error, "P2002") || isPrismaError(error, "P2034")) return apiError("ADDRESS_RETRY_REQUIRED", "The address changed at the same time. Please retry.", 409);
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ addressId: string }> }) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to remove an address.", 401);
  const { addressId } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.address.findFirst({ where: { id: addressId, userId: session.userId, deletedAt: null }, select: { id: true, isDefault: true } });
      if (!current) return null;
      await tx.address.update({ where: { id: addressId }, data: { deletedAt: new Date(), isDefault: false } });
      let newDefaultAddressId: string | null = null;
      if (current.isDefault) {
        const replacement = await tx.address.findFirst({ where: { userId: session.userId, deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true } });
        if (replacement) {
          await tx.address.update({ where: { id: replacement.id }, data: { isDefault: true } });
          newDefaultAddressId = replacement.id;
        }
      }
      await tx.auditLog.create({ data: { actorId: session.userId, action: "address.deleted", entityType: "Address", entityId: addressId, metadata: { wasDefault: current.isDefault, newDefaultAddressId } } });
      return { removedAddressId: addressId, newDefaultAddressId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result) return apiError("ADDRESS_NOT_FOUND", "The saved address was not found.", 404);
    return apiSuccess(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (isPrismaError(error, "P2002") || isPrismaError(error, "P2034")) return apiError("ADDRESS_RETRY_REQUIRED", "The address changed at the same time. Please retry.", 409);
    throw error;
  }
}
