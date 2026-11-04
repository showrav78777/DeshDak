import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { addressSchema } from "@/modules/users/address";

const addressSelect = { id: true, label: true, fullName: true, phone: true, addressLine1: true, addressLine2: true, city: true, district: true, postalCode: true, countryCode: true, isDefault: true } as const;

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view saved addresses.", 401);
  const addresses = await prisma.address.findMany({ where: { userId: session.userId, deletedAt: null }, select: addressSelect, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
  return apiSuccess({ addresses }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to save an address.", 401);
  const parsed = addressSchema.extend({ isDefault: z.boolean().default(false) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the delivery address.", 422, z.treeifyError(parsed.error));
  try {
    const address = await prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId: session.userId, deletedAt: null } });
      const makeDefault = parsed.data.isDefault || count === 0;
      if (makeDefault) await tx.address.updateMany({ where: { userId: session.userId, deletedAt: null, isDefault: true }, data: { isDefault: false } });
      const created = await tx.address.create({ data: { userId: session.userId, ...parsed.data, addressLine2: parsed.data.addressLine2 || null, postalCode: parsed.data.postalCode || null, isDefault: makeDefault }, select: addressSelect });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "address.created", entityType: "Address", entityId: created.id, metadata: { countryCode: created.countryCode, isDefault: created.isDefault } } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return apiSuccess({ address }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return apiError("ADDRESS_RETRY_REQUIRED", "The address changed at the same time. Please retry.", 409);
    throw error;
  }
}
