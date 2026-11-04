import { apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
/** Public country availability only. Provider names and integration details are private operations data. */
export async function GET() {
  const configuredCountries = await prisma.country.findMany({ orderBy: { name: "asc" }, select: { isoCode: true, name: true, isActive: true, originLanes: { where: { isActive: true }, select: { id: true } } } });
  const sourceCountries = configuredCountries.length ? configuredCountries.filter((country) => country.isActive && country.originLanes.length > 0).map((country) => ({ code: country.isoCode, name: country.name, enabled: true })) : [{ code: "CN", name: "China", enabled: true }];
  return apiSuccess({ sourceCountries, futureCountryConfigurationSupported: true });
}
