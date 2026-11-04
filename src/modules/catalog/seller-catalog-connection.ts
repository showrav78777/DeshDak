import "server-only";
import { z } from "zod";
import { SELLER_CATALOG_AUTH_METHODS, SELLER_CATALOG_CAPABILITIES } from "@/modules/catalog/seller-catalog-connection-fields";

export const SELLER_CATALOG_CONSENT_VERSION = "seller-catalog-connector-v1";

const unsafeHostSuffixes = [".local", ".localhost", ".internal", ".home", ".lan"];

function unsafeIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113);
}

export function isAllowedExternalHttpsUrl(value: string, baseUrl = false) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") || url.port && url.port !== "443") return false;
    if (host.includes(":") || host === "localhost" || unsafeHostSuffixes.some((suffix) => host.endsWith(suffix)) || unsafeIpv4(host)) return false;
    if (baseUrl && (url.search || url.hash)) return false;
    return true;
  } catch {
    return false;
  }
}

const externalUrl = (baseUrl = false) => z.string().trim().url().max(500).refine((value) => isAllowedExternalHttpsUrl(value, baseUrl), "Use a public HTTPS URL without credentials, private/local addresses, query credentials, or unsafe ports.");

export const sellerCatalogConnectionRequestSchema = z.object({
  systemName: z.string().trim().min(2).max(100),
  apiBaseUrl: externalUrl(true),
  apiDocumentationUrl: z.preprocess((value) => value === "" || value === null ? null : value, externalUrl(true).nullable()),
  authMethod: z.enum(SELLER_CATALOG_AUTH_METHODS),
  requestedCapabilities: z.array(z.enum(SELLER_CATALOG_CAPABILITIES)).min(1).max(SELLER_CATALOG_CAPABILITIES.length).transform((items) => [...new Set(items)]),
  expectedProductCount: z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.coerce.number().int().min(1).max(1_000_000).nullable()),
  requestedSyncFrequencyMinutes: z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.coerce.number().int().min(15).max(10_080).nullable()),
  sellerNote: z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(1000).nullable()),
  consent: z.literal("AUTHORIZE_READ_ONLY_CATALOG_REVIEW"),
}).strict();

export const sellerCatalogConnectionResubmitSchema = sellerCatalogConnectionRequestSchema.extend({
  version: z.coerce.number().int().min(1),
});

export const sellerCatalogConnectionRevokeSchema = z.object({
  version: z.coerce.number().int().min(1),
  confirmation: z.literal("REVOKE_CATALOG_ACCESS"),
}).strict();

export const adminSellerCatalogConnectionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("REQUEST_CHANGES"), version: z.coerce.number().int().min(1), reviewNote: z.string().trim().min(3).max(1000) }).strict(),
  z.object({ decision: z.literal("REJECT"), version: z.coerce.number().int().min(1), reviewNote: z.string().trim().min(3).max(1000) }).strict(),
  z.object({
    decision: z.literal("SAVE_CONFIGURATION"),
    version: z.coerce.number().int().min(1),
    reviewNote: z.string().trim().min(3).max(1000),
    adapterKey: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,79}$/, "Use an uppercase reviewed adapter key."),
    secretReference: z.string().trim().regex(/^secret:\/\/[A-Za-z0-9_./-]{3,240}$/, "Enter a secret-manager reference, never a credential."),
    dataUseApproved: z.literal(true),
    mediaRightsApproved: z.literal(true),
    securityApproved: z.literal(true),
  }).strict(),
]);

export function sellerCatalogSystemKey(systemName: string) {
  return systemName.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

type ConnectionViewInput = {
  id: string;
  systemName: string;
  apiBaseUrl: string;
  apiDocumentationUrl: string | null;
  authMethod: string;
  requestedCapabilities: string[];
  expectedProductCount: number | null;
  requestedSyncFrequencyMinutes: number | null;
  sellerNote: string | null;
  consentVersion: string;
  consentGrantedAt: Date;
  consentRevokedAt: Date | null;
  status: string;
  adapterKey: string | null;
  secretReference: string | null;
  dataUseApproved: boolean;
  mediaRightsApproved: boolean;
  securityApproved: boolean;
  reviewNote: string | null;
  reviewedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export function sellerCatalogConnectionView(connection: ConnectionViewInput, admin: true): ReturnType<typeof adminConnectionView>;
export function sellerCatalogConnectionView(connection: ConnectionViewInput, admin?: false): ReturnType<typeof sellerConnectionView>;
export function sellerCatalogConnectionView(connection: ConnectionViewInput, admin = false) {
  return admin ? adminConnectionView(connection) : sellerConnectionView(connection);
}

function sellerConnectionView(connection: ConnectionViewInput) {
  const common = {
    id: connection.id,
    systemName: connection.systemName,
    apiBaseUrl: connection.apiBaseUrl,
    apiDocumentationUrl: connection.apiDocumentationUrl,
    authMethod: connection.authMethod,
    requestedCapabilities: connection.requestedCapabilities,
    expectedProductCount: connection.expectedProductCount,
    requestedSyncFrequencyMinutes: connection.requestedSyncFrequencyMinutes,
    sellerNote: connection.sellerNote,
    consentVersion: connection.consentVersion,
    consentGrantedAt: connection.consentGrantedAt.toISOString(),
    consentRevokedAt: connection.consentRevokedAt?.toISOString() ?? null,
    status: connection.status,
    reviewNote: connection.reviewNote,
    version: connection.version,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    activationLocked: true,
  };
  return common;
}

function adminConnectionView(connection: ConnectionViewInput) {
  return {
    ...sellerConnectionView(connection),
    adapterKey: connection.adapterKey,
    secretReference: connection.secretReference ? "secret://••••••••" : null,
    secretReferenceConfigured: Boolean(connection.secretReference),
    dataUseApproved: connection.dataUseApproved,
    mediaRightsApproved: connection.mediaRightsApproved,
    securityApproved: connection.securityApproved,
    reviewedAt: connection.reviewedAt?.toISOString() ?? null,
  };
}
