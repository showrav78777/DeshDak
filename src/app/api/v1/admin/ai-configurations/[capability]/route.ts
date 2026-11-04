import { AiCapability, AiConfigurationMode, AiConfigurationStatus } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { AI_CONFIGURATION_DEFAULTS } from "@/modules/ai/configuration";

const optionalText = z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(255).nullable());
const schema = z.object({ apiBaseUrl: z.preprocess((value) => value === "" || value === null ? null : value, z.string().url().max(500).startsWith("https://").nullable()), modelName: optionalText, secretReference: z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().regex(/^secret:\/\/[A-Za-z0-9_./-]{3,240}$/, "Use a secret-manager reference such as secret://crossly/ai/image-search.").nullable()), anonymousLimit: z.coerce.number().int().min(1).max(10_000), maxInputBytes: z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.coerce.number().int().min(1024).max(20 * 1024 * 1024).nullable()), retentionMinutes: z.coerce.number().int().min(0).max(1_440), status: z.enum([AiConfigurationStatus.DISABLED, AiConfigurationStatus.CONFIGURATION_SAVED, AiConfigurationStatus.LIVE]) }).strict();

function safeApiUrl(value: string | null) { if (!value) return true; const url = new URL(value); const host = url.hostname.toLowerCase(); return !url.username && !url.password && host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && !host.endsWith(".local"); }

export async function PATCH(request: NextRequest, context: { params: Promise<{ capability: string }> }) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const { capability: rawCapability } = await context.params; const capability = Object.values(AiCapability).find((item) => item === rawCapability);
  if (!capability) return apiError("AI_CAPABILITY_NOT_FOUND", "AI capability was not found.", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Provide valid AI settings.", 422);
  if (!safeApiUrl(parsed.data.apiBaseUrl)) return apiError("API_URL_NOT_ALLOWED", "Use an external HTTPS URL without credentials or a local hostname.", 422);
  const defaults = AI_CONFIGURATION_DEFAULTS[capability];
  if (defaults.mode === AiConfigurationMode.EXTERNAL_ADAPTER && parsed.data.status === AiConfigurationStatus.LIVE) return apiError("AI_ACTIVATION_LOCKED", "External AI cannot be marked live until its reviewed adapter and health check are implemented.", 409);
  if (defaults.mode === AiConfigurationMode.INTERNAL_RULES && parsed.data.status === AiConfigurationStatus.CONFIGURATION_SAVED) return apiError("AI_STATUS_INVALID", "Internal capabilities must be live or disabled.", 422);
  if (defaults.mode === AiConfigurationMode.INTERNAL_RULES && (parsed.data.apiBaseUrl || parsed.data.secretReference)) return apiError("EXTERNAL_SETTINGS_NOT_ALLOWED", "Internal capabilities do not accept an external URL or secret reference.", 422);
  if (capability === AiCapability.CHATBOT && parsed.data.retentionMinutes < 15) return apiError("CHAT_RETENTION_TOO_SHORT", "Chatbot retention must be 15 to 1,440 minutes so a requested human handoff can preserve its transcript safely.", 422);
  if (parsed.data.status === AiConfigurationStatus.CONFIGURATION_SAVED && defaults.mode === AiConfigurationMode.EXTERNAL_ADAPTER && (!parsed.data.apiBaseUrl || !parsed.data.secretReference)) return apiError("EXTERNAL_CONFIGURATION_INCOMPLETE", "An HTTPS API base URL and secret-manager reference are required before saving external configuration.", 422);
  const saved = await prisma.$transaction(async (tx) => { const configuration = await tx.aiConfiguration.upsert({ where: { capability }, update: { ...parsed.data, updatedById: session.userId, lastHealthCheckAt: null, lastHealthStatus: null }, create: { ...defaults, ...parsed.data, capability, updatedById: session.userId } }); await tx.auditLog.create({ data: { actorId: session.userId, action: "ai.configuration_changed", entityType: "AiConfiguration", entityId: configuration.id, metadata: { capability, status: configuration.status, mode: configuration.mode, adapterKey: configuration.adapterKey, apiBaseUrlConfigured: Boolean(configuration.apiBaseUrl), modelName: configuration.modelName, secretReferenceConfigured: Boolean(configuration.secretReference), anonymousLimit: configuration.anonymousLimit, maxInputBytes: configuration.maxInputBytes, retentionMinutes: configuration.retentionMinutes } } }); return configuration; });
  return apiSuccess({ configuration: { ...saved, secretReference: saved.secretReference ? "secret://••••••••" : null }, activationLocked: saved.mode === AiConfigurationMode.EXTERNAL_ADAPTER });
}
