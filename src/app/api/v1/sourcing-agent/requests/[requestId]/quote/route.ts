import { type NextRequest } from "next/server";
import { POST as createQuote } from "@/app/api/v1/admin/sourcing-requests/[requestId]/quote/route";

// The canonical handler enforces getRequestSession, same-origin validation, and apiSuccess/apiError envelopes.
export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) { return createQuote(request, context); }
