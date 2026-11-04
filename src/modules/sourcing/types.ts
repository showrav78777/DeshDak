export type SourcePlatformCode = "PINDUODUO" | "SOURCE_1688" | "ALIBABA";

export type SourceProduct = {
  externalProductId: string;
  title: string;
  description?: string;
  sourceUrl?: string;
  currency: string;
  price: number;
  imageUrls: string[];
  available: boolean;
  attributes?: Record<string, string>;
};

export type SourceSearchInput = { query: string; page: number; pageSize: number };

export type SourceSearchResult = { products: SourceProduct[]; nextPage?: number };

export type SourceAdapterHealth = { code: SourcePlatformCode; configured: boolean; healthy: boolean; message: string };

export interface SourceAdapter {
  code: SourcePlatformCode;
  search(input: SourceSearchInput): Promise<SourceSearchResult>;
  getHealth(): Promise<SourceAdapterHealth>;
}
