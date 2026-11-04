const INTERNAL_ORIGIN = "https://crossly.invalid";
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;

export function safeInternalPath(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || UNSAFE_CHARACTERS.test(value) || ENCODED_SEPARATOR.test(value)) return fallback;
  try {
    const resolved = new URL(value, INTERNAL_ORIGIN);
    if (resolved.origin !== INTERNAL_ORIGIN || !resolved.pathname.startsWith("/")) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
