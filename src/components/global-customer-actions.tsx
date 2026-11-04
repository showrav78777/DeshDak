"use client";

import Link from "next/link";
import { DuarIcon } from "@/components/duar-icon";
import { usePathname, useRouter } from "next/navigation";
import { hidesCustomerChrome } from "@/lib/customer-route";

export const OPEN_SHOPPING_ASSISTANT_EVENT = "crossly:open-shopping-assistant";

export function GlobalCustomerActions() {
  const pathname = usePathname();
  const router = useRouter();
  if (hidesCustomerChrome(pathname)) return null;

  function openAssistant() {
    router.push("/assistant");
  }

  return <aside className="global-customer-actions" aria-label="Quick marketplace actions">
    <Link className="global-reels-action" href="/reels" title="Watch product reels"><span aria-hidden="true"><DuarIcon name="reels" /></span><b>Reels</b></Link>
    <button className="global-ai-action" onClick={openAssistant} type="button" title="Open AI shopping assistant"><span aria-hidden="true"><DuarIcon name="ai" /></span><b>Ask AI</b></button>
  </aside>;
}
