import { randomBytes } from "node:crypto";

export type PlatformEntity = "ORDER" | "PRODUCT" | "PERSON" | "STORE" | "WAREHOUSE" | "SHIPMENT";

const prefixes: Record<PlatformEntity, string> = {
  ORDER: "ORD",
  PRODUCT: "PRD",
  PERSON: "PER",
  STORE: "STR",
  WAREHOUSE: "WHS",
  SHIPMENT: "SHP",
};

// Twelve-character order references and 32-character migration backfills are
// retained as valid legacy codes; all new codes use 20 hexadecimal characters.
const codePattern = /^(ORD|PRD|PER|STR|WHS|SHP)-[A-F0-9]{12,32}$/;

export function createPlatformCode(entity: PlatformEntity) {
  return `${prefixes[entity]}-${randomBytes(10).toString("hex").toUpperCase()}`;
}

export function isPlatformCode(value: string) {
  return codePattern.test(value);
}

export function barcodeValue(platformCode: string) {
  if (!isPlatformCode(platformCode)) throw new Error("INVALID_PLATFORM_CODE");
  return platformCode;
}
