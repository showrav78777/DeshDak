import "server-only";

export function websiteMediaUploadsEnabled() {
  return process.env.NODE_ENV !== "production" || Boolean(process.env.WEBSITE_MEDIA_SCAN_URL && process.env.WEBSITE_MEDIA_SCAN_TOKEN);
}

export async function scanWebsiteMedia(file: File) {
  const endpoint = process.env.WEBSITE_MEDIA_SCAN_URL;
  const token = process.env.WEBSITE_MEDIA_SCAN_TOKEN;
  if (!endpoint || !token) {
    if (process.env.NODE_ENV !== "production") return;
    throw new Error("Media scanning must be configured before production uploads.");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Invalid media scanner configuration.");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" }, body: await file.arrayBuffer(), redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error("Media scan unavailable. Try again later.");
  const result = await response.json();
  if (result?.status !== "clean") throw new Error("Image did not pass the security scan.");
}
