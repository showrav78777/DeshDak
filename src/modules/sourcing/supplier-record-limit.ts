/** Includes superseded records: retained evidence still consumes capacity. */
export const SUPPLIER_RECORD_LIMIT = 100;

export function supplierRecordLimitReached(total: number) {
  return total >= SUPPLIER_RECORD_LIMIT;
}
