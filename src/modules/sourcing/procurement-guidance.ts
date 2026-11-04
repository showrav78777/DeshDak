type RecordSummary = { correction: unknown; inboundDispatch: { package: { status: string; isOutboundActive: boolean } } | null };

/** Display-only guidance. API guards remain authoritative for every action. */
export function procurementGuidance(input: { status: string; records: RecordSummary[]; totalRecords: number; remainingQuantities: number[] }) {
  const active = input.records.filter(record => !record.correction);
  const dispatched = active.filter(record => record.inboundDispatch);
  const awaiting = dispatched.filter(record => record.inboundDispatch!.package.status === "EXPECTED").length;
  const received = dispatched.filter(record => ["RECEIVED", "INSPECTED", "MEASURED", "READY_TO_SHIP", "SHIPPED"].includes(record.inboundDispatch!.package.status)).length;
  const completeList = input.totalRecords === input.records.length;
  const coverage = completeList && input.remainingQuantities.length > 0 && input.remainingQuantities.every(quantity => quantity === 0);
  const counts = completeList ? { active: active.length, dispatched: dispatched.length, awaiting, received } : null;
  const result = (step: number | null, message: string) => ({ step, message, counts });
  if (!completeList) return result(null, "This order has more records than the bounded summary can include. Counts and readiness are unavailable. Use Previous records and Next records to review all pages with operations; do not assume one page is the complete order.");
  if (input.status === "ON_HOLD") return result(null, "Order paused. Review the hold and private audit before continuing. Do not purchase again or change tracking to bypass review.");
  if (dispatched.some(record => !record.inboundDispatch!.package.isOutboundActive)) return result(null, "A linked parcel is inactive. Ask operations to review the parcel history before continuing. Do not recreate the supplier purchase.");
  if (input.status === "SOURCING") return coverage
    ? result(1, "Supplier quantities are fully recorded. Return to the purchase queue and confirm purchase only after checking the actual supplier purchase.")
    : result(0, "Record the real supplier reference, item, quantity and origin warehouse. Every ordered quantity must be covered exactly before purchase confirmation.");
  if (input.status === "PURCHASED") return !coverage
    ? result(null, "Supplier quantity evidence needs review. Ask operations to check the complete order; do not invent additional purchases or dispatch details.")
    : active.length > dispatched.length
      ? result(2, `Record verified carrier and tracking for ${active.length - dispatched.length} remaining supplier record(s). All records must be dispatched before warehouse receiving starts.`)
      : result(null, "All visible dispatches are recorded but the order is still Purchased. Ask operations to review the stage; do not resubmit the supplier purchase.");
  if (input.status === "SUPPLIER_SHIPPED") return coverage && active.length === dispatched.length && awaiting > 0
    ? result(3, `Waiting for physical warehouse confirmation of ${awaiting} parcel(s). Assigned warehouse staff scan each parcel. Inspection waits until every expected parcel arrives.`)
    : result(null, "The dispatch manifest and order stage need operations review. A dispatch record is not proof of physical warehouse receipt.");
  if (["WAREHOUSE_RECEIVED", "INSPECTION"].includes(input.status)) return result(null, "Receiving is recorded. Assigned inspectors handle inspection in their portal; warehouse staff then measure passed parcels. Supplier records remain read-only here.");
  return result(null, "This stage is read-only for procurement. Review the current order in Order operations; do not use supplier records to force a stage change.");
}
