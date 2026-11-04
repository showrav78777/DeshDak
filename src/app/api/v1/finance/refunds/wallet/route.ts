import { type NextRequest } from "next/server";
import { POST as postWalletRefund } from "@/app/api/v1/admin/refunds/wallet/route";

// The canonical handler enforces getRequestSession, reads headers.get("Idempotency-Key"), and returns apiSuccess/apiError envelopes.
export async function POST(request: NextRequest) { return postWalletRefund(request); }
