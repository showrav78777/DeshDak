import { type NextRequest } from "next/server";
import { GET as listRates, POST as createRate } from "@/app/api/v1/admin/fx-rates/route";

// Delegated canonical handlers enforce getRequestSession and return apiSuccess/apiError envelopes.
export async function GET(request: NextRequest) { return listRates(request); }
export async function POST(request: NextRequest) { return createRate(request); }
