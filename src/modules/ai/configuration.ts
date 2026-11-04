import { AiCapability, AiConfigurationMode, AiConfigurationStatus, type AiConfiguration } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AiConfigurationView = Omit<AiConfiguration, "createdAt" | "updatedAt" | "lastHealthCheckAt"> & { createdAt: string | null; updatedAt: string | null; lastHealthCheckAt: string | null };

export const AI_CONFIGURATION_DEFAULTS: Record<AiCapability, Omit<AiConfiguration, "id" | "createdAt" | "updatedAt">> = {
  TEXT_SEARCH: { capability: AiCapability.TEXT_SEARCH, displayName: "Text product search", mode: AiConfigurationMode.INTERNAL_RULES, status: AiConfigurationStatus.LIVE, adapterKey: "INTERNAL_KEYWORD", apiBaseUrl: null, modelName: null, secretReference: null, anonymousLimit: 40, maxInputBytes: null, retentionMinutes: 0, updatedById: null, lastHealthCheckAt: null, lastHealthStatus: "Internal service" },
  CHATBOT: { capability: AiCapability.CHATBOT, displayName: "Public shopping assistant", mode: AiConfigurationMode.INTERNAL_RULES, status: AiConfigurationStatus.LIVE, adapterKey: "INTERNAL_FAQ", apiBaseUrl: null, modelName: null, secretReference: null, anonymousLimit: 25, maxInputBytes: null, retentionMinutes: 1_440, updatedById: null, lastHealthCheckAt: null, lastHealthStatus: "Internal service" },
  IMAGE_SEARCH: { capability: AiCapability.IMAGE_SEARCH, displayName: "Image product search", mode: AiConfigurationMode.EXTERNAL_ADAPTER, status: AiConfigurationStatus.DISABLED, adapterKey: "VISION_EMBEDDING", apiBaseUrl: null, modelName: null, secretReference: null, anonymousLimit: 8, maxInputBytes: 5 * 1024 * 1024, retentionMinutes: 0, updatedById: null, lastHealthCheckAt: null, lastHealthStatus: null },
  RECOMMENDATIONS: { capability: AiCapability.RECOMMENDATIONS, displayName: "Product recommendations", mode: AiConfigurationMode.INTERNAL_RULES, status: AiConfigurationStatus.LIVE, adapterKey: "INTERNAL_MARKET_RANKING_V1", apiBaseUrl: null, modelName: null, secretReference: null, anonymousLimit: 30, maxInputBytes: null, retentionMinutes: 0, updatedById: null, lastHealthCheckAt: null, lastHealthStatus: "Availability, quality, engagement, and market-aware ranking" },
};

export async function getAiConfiguration(capability: AiCapability) { return (await prisma.aiConfiguration.findUnique({ where: { capability } })) ?? AI_CONFIGURATION_DEFAULTS[capability]; }

export function toAiConfigurationView(configuration: AiConfiguration | (typeof AI_CONFIGURATION_DEFAULTS)[AiCapability]): AiConfigurationView {
  return { ...configuration, id: "id" in configuration ? configuration.id : `default-${configuration.capability}`, createdAt: "createdAt" in configuration ? configuration.createdAt.toISOString() : null, updatedAt: "updatedAt" in configuration ? configuration.updatedAt.toISOString() : null, lastHealthCheckAt: configuration.lastHealthCheckAt?.toISOString() ?? null };
}
