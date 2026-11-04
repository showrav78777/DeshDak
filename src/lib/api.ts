import { NextResponse } from "next/server";

export function apiSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function apiError(code: string, message: string, status = 400, details?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}
