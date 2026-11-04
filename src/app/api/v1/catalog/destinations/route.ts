import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { hasRuntimeReadyPaymentOption } from "@/modules/payments/availability";

const COUNTRY_CODE = /^[A-Z]{2}$/;

export async function GET(request: NextRequest) {
  const origin = (request.nextUrl.searchParams.get("origin") ?? "BD").trim().toUpperCase();
  if (!COUNTRY_CODE.test(origin)) return apiError("INVALID_ORIGIN_COUNTRY", "Use a valid two-letter origin country code.", 422);

  const lanes = await prisma.shippingLane.findMany({
    where: {
      isActive: true,
      checkoutEnabled: true,
      financeApproved: true,
      complianceApproved: true,
      operationsApproved: true,
      originCountry: { is: { isoCode: origin, isActive: true } },
      destinationCountry: { is: { isActive: true } },
    },
    select: {
      id: true,
      name: true,
      transitDaysMin: true,
      transitDaysMax: true,
      destinationCountry: { select: { isoCode: true, name: true, defaultCurrency: true, defaultLocale: true, paymentMethods: { where: { checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { customerCurrency: true, paymentMethod: { select: { adapterCode: true } } } } } },
    },
    orderBy: [{ destinationCountry: { name: "asc" } }, { name: "asc" }],
  });

  const readyLanes = (await Promise.all(lanes.map(async (lane) => await hasRuntimeReadyPaymentOption(prisma, lane.destinationCountry.paymentMethods) ? lane : null))).filter((lane): lane is NonNullable<typeof lane> => Boolean(lane));
  return apiSuccess({
    originCountryCode: origin,
    destinations: readyLanes.map((lane) => ({
      shippingLaneId: lane.id,
      serviceName: lane.name,
      transitDaysMin: lane.transitDaysMin,
      transitDaysMax: lane.transitDaysMax,
      country: { isoCode: lane.destinationCountry.isoCode, name: lane.destinationCountry.name, defaultCurrency: lane.destinationCountry.defaultCurrency, defaultLocale: lane.destinationCountry.defaultLocale },
    })),
  }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
