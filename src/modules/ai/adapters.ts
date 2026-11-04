import { AiCapability, AiConfigurationStatus } from "@prisma/client";
import { getAiConfiguration } from "./configuration";

export class AiAdapterUnavailableError extends Error { constructor() { super("The approved external AI adapter is not active."); } }

// Routes must use this boundary instead of calling a saved URL. A reviewed adapter,
// secret lookup, health check, and provider response validation belong here.
export async function requireLiveExternalAiAdapter(capability: AiCapability) {
  const configuration = await getAiConfiguration(capability);
  if (configuration.status !== AiConfigurationStatus.LIVE || configuration.mode !== "EXTERNAL_ADAPTER") throw new AiAdapterUnavailableError();
  throw new AiAdapterUnavailableError();
}
