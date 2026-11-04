import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/server-session";
import { getWarehouseAccess } from "@/lib/warehouse-access";

export async function requireWarehousePageSession() {
  const session = await getServerSession();
  const access = await getWarehouseAccess(session);
  if (!session || !access || access.isAdmin) redirect("/warehouse/login");
  return { session, access };
}
