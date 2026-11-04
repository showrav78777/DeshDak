import { type NextRequest } from "next/server";
import { PATCH as updateRate } from "@/app/api/v1/admin/fx-rates/[rateId]/route";

// The canonical handler enforces getRequestSession and returns apiSuccess/apiError envelopes.
export async function PATCH(request: NextRequest, context: { params: Promise<{ rateId: string }> }) { return updateRate(request, context); }
