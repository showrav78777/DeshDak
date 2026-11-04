import { apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const countries = await prisma.country.findMany({
    where: { isActive: true },
    select: {
      isoCode: true,
      name: true,
      defaultCurrency: true,
      defaultLocale: true,
      destinationLanes: {
        where: {
          isActive: true,
          checkoutEnabled: true,
          financeApproved: true,
          complianceApproved: true,
          operationsApproved: true,
          originCountry: { is: { isActive: true } },
        },
        select: { id: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return apiSuccess({
    markets: countries.map(({ destinationLanes, ...country }) => ({
      ...country,
      parcelDeliveryAvailable: destinationLanes.length > 0,
    })),
  }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
