import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/server-session";
import { getLogisticsAccess } from "@/lib/warehouse-access";

export async function requireLogisticsPageSession() {
  const session = await getServerSession();
  const access = await getLogisticsAccess(session);
  if (!session || !access || access.isAdmin) redirect("/logistics/login");
  return { session, access };
}
