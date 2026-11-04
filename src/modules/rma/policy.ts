import type { OrderType, RmaReason, RmaStatus } from "@prisma/client";

export const RMA_EVIDENCE_PATTERN = /^rma-evidence\/[A-Za-z0-9/_-]+\.(?:jpe?g|png|webp|mp4|pdf)$/i;
export const RMA_ACTIVE_STATUSES: RmaStatus[] = ["RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_IN_TRANSIT", "RETURN_RECEIVED", "INSPECTED"];
export const RMA_TERMINAL_STATUSES: RmaStatus[] = ["RETURN_REJECTED", "REFUNDED", "REPLACED", "CLOSED"];

const transitions: Record<RmaStatus, RmaStatus[]> = {
  RETURN_REQUESTED: ["RETURN_APPROVED", "RETURN_REJECTED"],
  RETURN_APPROVED: ["RETURN_IN_TRANSIT", "RETURN_RECEIVED", "INSPECTED", "REPLACED", "CLOSED"],
  RETURN_REJECTED: ["CLOSED"],
  RETURN_IN_TRANSIT: ["RETURN_RECEIVED"],
  RETURN_RECEIVED: ["INSPECTED"],
  INSPECTED: ["REFUNDED", "REPLACED", "CLOSED"],
  REFUNDED: ["CLOSED"],
  REPLACED: ["CLOSED"],
  CLOSED: [],
};

export function canTransitionRma(from: RmaStatus, to: RmaStatus) {
  return transitions[from].includes(to);
}

export function addBusinessDays(start: Date, days = 5) {
  const result = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

export function rmaSlaBusinessDays() {
  const configured = Number(process.env.RMA_SLA_BUSINESS_DAYS ?? 5);
  return Number.isInteger(configured) && configured >= 3 && configured <= 5 ? configured : 5;
}

export function isReasonEligible(orderType: OrderType, reason: RmaReason) {
  if (orderType === "SHIP_FOR_ME") return reason === "LOST" || reason === "DAMAGED";
  return ["NOT_DELIVERED", "LOST", "WRONG_ITEM", "DAMAGED", "NOT_AS_DESCRIBED", "MISSING_PARTS"].includes(reason);
}

export function rmaStatusLabel(status: RmaStatus) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
