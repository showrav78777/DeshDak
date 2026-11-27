import "server-only";
import { PrivateVideoPreviewError, type createPrivateVideoPreview } from "./video-preview";

const securityHeaders = {
  "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'; sandbox",
  Vary: "Cookie, Authorization, Range, If-Range",
};

/** Response adapter only; no runtime or route is wired to staged preview. */
export function createPrivateVideoPreviewResponse(preview: ReturnType<typeof createPrivateVideoPreview>) {
  return async (input: Parameters<typeof preview.read>[0]) => {
    try {
      const result = await preview.read(input);
      const headers = new Headers(securityHeaders);
      headers.set("Content-Type", result.mimeType); headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Length", String(result.end - result.start + 1));
      headers.set("Content-Disposition", `inline; filename=inspection-preview.${result.artifact === "video" ? "mp4" : "jpg"}`);
      if (result.status === 206) headers.set("Content-Range", `bytes ${result.start}-${result.end}/${result.totalBytes}`);
      return new Response(result.bytes ? new Uint8Array(result.bytes) : null, { status: result.status, headers });
    } catch (error) {
      const headers = new Headers(securityHeaders);
      if (error instanceof PrivateVideoPreviewError && error.code === "PRIVATE_VIDEO_RANGE_INVALID" && Number.isSafeInteger(error.authorizedTotal)) {
        headers.set("Content-Range", `bytes */${error.authorizedTotal}`); headers.set("Content-Length", "0");
        return new Response(null, { status: 416, headers });
      }
      const code = error instanceof PrivateVideoPreviewError ? error.code : "PRIVATE_VIDEO_PREVIEW_UNAVAILABLE";
      const status = code === "PRIVATE_VIDEO_PREVIEW_DENIED" ? 403 : code === "PRIVATE_VIDEO_NOT_PUBLISHED" ? 409 : code === "PRIVATE_VIDEO_METHOD_NOT_ALLOWED" ? 405 : 503;
      if (status === 405) headers.set("Allow", "GET, HEAD");
      headers.set("Content-Type", "application/json");
      const body = JSON.stringify({ error: { code, message: status === 409 ? "This video is not published." : "This preview cannot be opened securely." } });
      return new Response(input.method === "HEAD" ? null : body, { status, headers });
    }
  };
}
