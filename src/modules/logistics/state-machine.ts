import type { OrderStatus, ShipmentStatus } from "@prisma/client";

const exceptionStatuses = ["FAILED_DELIVERY", "DAMAGED", "LOST", "HELD", "RETURNED", "CUSTOMS_EXCEPTION", "EXCEPTION"] satisfies ShipmentStatus[];

const normalNext: Record<ShipmentStatus, ShipmentStatus[]> = {
  CREATED: ["PICKUP_PENDING"],
  PICKUP_PENDING: ["PICKED_UP"],
  PICKED_UP: ["ORIGIN_WAREHOUSE"],
  ORIGIN_WAREHOUSE: ["CONSOLIDATED"],
  CONSOLIDATED: ["READY_FOR_EXPORT"],
  READY_FOR_EXPORT: ["DEPARTED_ORIGIN"],
  DEPARTED_ORIGIN: ["IN_TRANSIT"],
  IN_TRANSIT: ["DESTINATION_ARRIVAL"],
  DESTINATION_ARRIVAL: ["CUSTOMS"],
  CUSTOMS: ["CUSTOMS_CLEARED"],
  CUSTOMS_CLEARED: ["DESTINATION_WAREHOUSE"],
  DESTINATION_WAREHOUSE: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  FAILED_DELIVERY: ["OUT_FOR_DELIVERY", "RETURNED"],
  DAMAGED: ["HELD", "RETURNED"],
  LOST: [],
  HELD: ["IN_TRANSIT", "CUSTOMS", "DESTINATION_WAREHOUSE", "RETURNED"],
  RETURNED: [],
  CUSTOMS_EXCEPTION: ["CUSTOMS", "RETURNED"],
  EXCEPTION: ["HELD", "RETURNED"],
};

export function getAllowedShipmentTransitions(status: ShipmentStatus) {
  if (["DELIVERED", "LOST", "RETURNED"].includes(status)) return [];
  return [...new Set([...normalNext[status], ...exceptionStatuses.filter((candidate) => candidate !== status)])];
}

export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus) {
  return getAllowedShipmentTransitions(from).includes(to);
}

export function orderStatusForShipment(status: ShipmentStatus, destinationCountryCode: string | null): OrderStatus | null {
  if (["DEPARTED_ORIGIN", "IN_TRANSIT", "DESTINATION_ARRIVAL"].includes(status)) return "IN_TRANSIT";
  if (["CUSTOMS", "CUSTOMS_CLEARED", "CUSTOMS_EXCEPTION"].includes(status)) return "CUSTOMS";
  if (status === "DESTINATION_WAREHOUSE") return destinationCountryCode === "BD" ? "BD_WAREHOUSE" : "DESTINATION_WAREHOUSE";
  if (status === "OUT_FOR_DELIVERY" || status === "FAILED_DELIVERY") return "OUT_FOR_DELIVERY";
  if (status === "DELIVERED") return "DELIVERED";
  if (["DAMAGED", "LOST", "HELD", "EXCEPTION"].includes(status)) return "ON_HOLD";
  return null;
}

const holdShipmentStatuses = new Set<ShipmentStatus>(["DAMAGED", "LOST", "HELD", "RETURNED", "CUSTOMS_EXCEPTION", "EXCEPTION"]);
const shipmentMilestones: Array<{ statuses: Set<ShipmentStatus>; orderStatus: "DELIVERED" | "OUT_FOR_DELIVERY" | "DESTINATION_WAREHOUSE" | "CUSTOMS" | "IN_TRANSIT" }> = [
  { statuses: new Set(["DELIVERED"]), orderStatus: "DELIVERED" },
  { statuses: new Set(["OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"]), orderStatus: "OUT_FOR_DELIVERY" },
  { statuses: new Set(["DESTINATION_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"]), orderStatus: "DESTINATION_WAREHOUSE" },
  { statuses: new Set(["CUSTOMS", "CUSTOMS_CLEARED", "DESTINATION_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"]), orderStatus: "CUSTOMS" },
  { statuses: new Set(["DEPARTED_ORIGIN", "IN_TRANSIT", "DESTINATION_ARRIVAL", "CUSTOMS", "CUSTOMS_CLEARED", "DESTINATION_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"]), orderStatus: "IN_TRANSIT" },
];

export function aggregateOrderStatusForShipments(statuses: ShipmentStatus[], destinationCountryCode: string | null): OrderStatus | null {
  if (!statuses.length) return null;
  if (statuses.some((status) => holdShipmentStatuses.has(status))) return "ON_HOLD";
  const milestone = shipmentMilestones.find(({ statuses: accepted }) => statuses.every((status) => accepted.has(status)));
  if (!milestone) return null;
  if (milestone.orderStatus === "DESTINATION_WAREHOUSE" && destinationCountryCode === "BD") return "BD_WAREHOUSE";
  return milestone.orderStatus;
}

export const shipmentStatusLabels: Record<ShipmentStatus, string> = {
  CREATED: "Created", PICKUP_PENDING: "Pickup pending", PICKED_UP: "Picked up", ORIGIN_WAREHOUSE: "Origin warehouse", CONSOLIDATED: "Consolidated", READY_FOR_EXPORT: "Ready for export", DEPARTED_ORIGIN: "Departed origin", IN_TRANSIT: "In transit", DESTINATION_ARRIVAL: "Destination arrival", CUSTOMS: "Customs processing", CUSTOMS_CLEARED: "Customs cleared", DESTINATION_WAREHOUSE: "Destination warehouse", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", FAILED_DELIVERY: "Failed delivery", DAMAGED: "Damaged", LOST: "Lost", HELD: "Held", RETURNED: "Returned", CUSTOMS_EXCEPTION: "Customs exception", EXCEPTION: "Exception",
};
