export type ProductCompletenessInput = {
  titleEn: string;
  titleBn?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  highlights?: string[];
  brand?: string | null;
  modelNumber?: string | null;
  hsCode?: string | null;
  minimumOrderQuantity: number;
  productionLeadDaysMin?: number | null;
  productionLeadDaysMax?: number | null;
  sellingUnit?: string | null;
  packageContents?: string | null;
  returnPolicy?: string | null;
  warrantyInfo?: string | null;
  hasPackedMeasurements: boolean;
  hasReadyMedia?: boolean;
};

function present(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function calculateProductCompleteness(input: ProductCompletenessInput) {
  const checks: Array<[boolean, number]> = [
    [present(input.titleEn), 7],
    [present(input.titleBn), 4],
    [present(input.shortDescription), 7],
    [present(input.description) && (input.description?.trim().length ?? 0) >= 80, 10],
    [(input.highlights?.length ?? 0) >= 3, 8],
    [present(input.brand), 5],
    [present(input.modelNumber), 3],
    [present(input.hsCode), 5],
    [input.minimumOrderQuantity > 0, 5],
    [input.productionLeadDaysMin !== null && input.productionLeadDaysMin !== undefined && input.productionLeadDaysMax !== null && input.productionLeadDaysMax !== undefined, 7],
    [present(input.sellingUnit), 5],
    [present(input.packageContents), 7],
    [present(input.returnPolicy), 5],
    [present(input.warrantyInfo), 4],
    [input.hasPackedMeasurements, 8],
    [Boolean(input.hasReadyMedia), 10],
  ];
  return checks.reduce((score, [passes, weight]) => score + (passes ? weight : 0), 0);
}
