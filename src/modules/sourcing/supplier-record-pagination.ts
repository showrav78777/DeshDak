export function supplierRecordPage(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 1;
  if (typeof raw !== "string" || !/^(?:[1-9]\d{0,3}|10000)$/.test(raw)) return null;
  return Number(raw);
}

export function supplierRecordPagination(page: number, total: number, pageSize: 20 | 100) {
  return { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), skip: (page - 1) * pageSize };
}
