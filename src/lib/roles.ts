export const ROLE = {
  CUSTOMER_PERSONAL: "customer_personal",
  CUSTOMER_BUSINESS: "customer_business",
  SELLER: "seller",
  ADMIN: "admin",
  SOURCING_AGENT: "sourcing_agent",
  KAM: "kam",
  WAREHOUSE_WORKER: "warehouse_worker",
  INSPECTOR: "inspector",
  LOGISTICS_WORKER: "logistics_worker",
  CUSTOMER_SERVICE: "customer_service",
  COMPLIANCE: "compliance",
  FINANCE: "finance",
} as const;

export type RoleCode = (typeof ROLE)[keyof typeof ROLE];
