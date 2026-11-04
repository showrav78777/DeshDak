import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/server-session";
import { getInspectorAccess } from "@/lib/warehouse-access";

export async function requireInspectorPageSession() {
  const session = await getServerSession();
  const access = await getInspectorAccess(session);
  if (!session || !access || access.isAdmin) redirect("/inspector/login");
  return { session, access };
}
