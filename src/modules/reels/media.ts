export function publicMediaUrl(storageKey: string) {
  const configured = process.env.PUBLIC_MEDIA_BASE_URL?.trim();
  if (!configured) return null;
  let base: URL;
  try {
    base = new URL(configured.endsWith("/") ? configured : `${configured}/`);
  } catch {
    return null;
  }
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") return null;
  const safePath = storageKey.split("/").map(encodeURIComponent).join("/");
  return new URL(safePath, base).toString();
}

export const publicReelMediaUrl = publicMediaUrl;
