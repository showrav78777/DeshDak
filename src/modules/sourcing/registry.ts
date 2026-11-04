import { UnconfiguredAdapter } from "@/modules/sourcing/adapters/unconfigured-adapter";
import type { SourceAdapter, SourcePlatformCode } from "@/modules/sourcing/types";

const adapters: Record<SourcePlatformCode, SourceAdapter> = {
  PINDUODUO: new UnconfiguredAdapter("PINDUODUO", "PINDUODUO_API_KEY"),
  SOURCE_1688: new UnconfiguredAdapter("SOURCE_1688", "SOURCE_1688_API_KEY"),
  ALIBABA: new UnconfiguredAdapter("ALIBABA", "ALIBABA_API_KEY"),
};

export function getSourceAdapter(code: SourcePlatformCode) { return adapters[code]; }
export function getSourceAdapters() { return Object.values(adapters); }
