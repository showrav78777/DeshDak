import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { advertisementPlacements } from "@/modules/advertisements/schemas";

const querySchema = z.object({ placement: z.enum(advertisementPlacements), path: z.string().startsWith("/").max(300).default("/") });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ placement: request.nextUrl.searchParams.get("placement"), path: request.nextUrl.searchParams.get("path") ?? "/" });
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid advertisement placement.", 422);
  const now = new Date();
  const advertisements = await prisma.advertisement.findMany({
    where: {
      status: "ACTIVE",
      placement: parsed.data.placement,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        { OR: [{ pagePath: null }, { pagePath: parsed.data.path }] },
      ],
    },
    select: { id: true, adCode: true, advertiserName: true, title: true, body: true, imageUrl: true, targetUrl: true, altText: true, placement: true, isDismissible: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    take: 5,
  });
  return apiSuccess({ advertisements }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
}
