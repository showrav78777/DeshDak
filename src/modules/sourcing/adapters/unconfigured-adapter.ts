import type { SourceAdapter, SourceAdapterHealth, SourcePlatformCode, SourceSearchInput, SourceSearchResult } from "@/modules/sourcing/types";

/**
 * Safe default for a source provider before its contract and credentials are approved.
 * It deliberately returns no products: the browser must never call a provider directly.
 */
export class UnconfiguredAdapter implements SourceAdapter {
  constructor(public readonly code: SourcePlatformCode, private readonly environmentKey: string) {}

  async search(_input: SourceSearchInput): Promise<SourceSearchResult> {
    void _input;
    return { products: [] };
  }

  async getHealth(): Promise<SourceAdapterHealth> {
    const configured = Boolean(process.env[this.environmentKey]);
    return { code: this.code, configured, healthy: false, message: configured ? "Credentials are present; provider contract implementation is pending." : "Awaiting approved provider credentials." };
  }
}
