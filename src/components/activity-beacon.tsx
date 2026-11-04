"use client";

import { useEffect, useState } from "react";

export function ActivityBeacon({ eventType, objectId, path, resultCount }: { eventType: "PRODUCT_VIEW" | "CATALOG_SEARCH" | "CATEGORY_VIEW"; objectId?: string; path: string; resultCount?: number }) {
  const [eventId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/activity/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType, objectId, path, resultCount, idempotencyKey: eventId }), signal: controller.signal }).catch(() => undefined);
    return () => controller.abort();
  }, [eventId, eventType, objectId, path, resultCount]);
  return null;
}
