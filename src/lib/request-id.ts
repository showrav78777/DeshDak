const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidRequestId(value: string | null | undefined): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function requestIdFromHeaders(headers: Headers) {
  const value = headers.get("x-request-id");
  return isValidRequestId(value) ? value : undefined;
}
