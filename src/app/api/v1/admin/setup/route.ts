import bcrypt from "bcryptjs";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { verifyHuman } from "@/lib/human-verification";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";

const schema = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), password: z.string().min(12).max(128), setupToken: z.string().max(256).optional(), humanVerificationToken: z.string().max(2048).optional(), "cf-turnstile-response": z.string().max(2048).optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Use a name, valid email, and a password with at least 12 characters.", 422, z.treeifyError(parsed.error));
  const configuredToken = process.env.INITIAL_ADMIN_SETUP_TOKEN;
  if (process.env.NODE_ENV === "production" && (!configuredToken || parsed.data.setupToken !== configuredToken)) return apiError("SETUP_TOKEN_REQUIRED", "A valid initial admin setup key is required.", 403);
  if (!(await verifyHuman(request, parsed.data.humanVerificationToken ?? parsed.data["cf-turnstile-response"], "admin_setup"))) return apiError("HUMAN_VERIFICATION_FAILED", "Please complete human verification and try again.", 403);
  const existingAdmin = await prisma.user.count({ where: { roles: { some: { role: { code: ROLE.ADMIN } } } } });
  if (existingAdmin > 0) return apiError("ADMIN_ALREADY_CONFIGURED", "An administrator already exists. Use the admin login page.", 409);
  try {
    const admin = await prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({ where: { code: ROLE.ADMIN }, update: {}, create: { code: ROLE.ADMIN, description: "Platform administrator" } });
      const user = await tx.user.create({ data: { fullName: parsed.data.fullName, email: parsed.data.email, passwordHash: await bcrypt.hash(parsed.data.password, 12), status: "ACTIVE", roles: { create: { roleId: role.id } } }, select: { id: true, email: true, fullName: true } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "admin.initial_setup_completed", entityType: "User", entityId: user.id } });
      return user;
    });
    return apiSuccess({ admin }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return apiError("EMAIL_IN_USE", "An account already uses this email.", 409);
    throw error;
  }
}
