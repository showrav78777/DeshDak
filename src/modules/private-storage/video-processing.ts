import "server-only";
import { createHash } from "node:crypto";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const inputMaximum = 30 * 1024 * 1024, videoMaximum = 8 * 1024 * 1024, posterMaximum = 512 * 1024;
function keys(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key)));
}
function artifact(value: unknown, mimeType: string, maximum: number) {
  if (!keys(value, ["mimeType", "sha256", "bytesBase64"]) || value.mimeType !== mimeType || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.bytesBase64 !== "string" || !value.bytesBase64.length || value.bytesBase64.length > Math.ceil(maximum / 3) * 4 || value.bytesBase64.length % 4) throw new Error("Invalid artifact");
  const bytes = Buffer.from(value.bytesBase64, "base64");
  if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== value.bytesBase64 || hash(bytes) !== value.sha256) throw new Error("Unconfirmed artifact");
  if (mimeType === "video/mp4" ? bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp" : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error("Unexpected artifact type");
  return { bytes, mimeType, sha256: value.sha256 };
}

/** Unwired component client. This neither stores evidence nor grants upload/delivery authority. */
export function createPrivateInspectionVideoProcessor(config: { url: string; token: string }, transport: typeof fetch = fetch) {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new Error("PRIVATE_VIDEO_PROCESSOR_UNAVAILABLE"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || typeof config.token !== "string" || config.token.length < 32 || config.token.length > 256 || /[\s\u0000-\u001f\u007f]/.test(config.token)) throw new Error("PRIVATE_VIDEO_PROCESSOR_UNAVAILABLE");
  return async (input: Buffer) => {
    if (!Buffer.isBuffer(input) || !input.length || input.length > inputMaximum) throw new Error("PRIVATE_VIDEO_PROCESSING_FAILED");
    const bytes = Buffer.from(input), originalSha256 = hash(bytes);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 95_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, removeAbort: (() => void) | undefined;
    try {
      const response = await transport(url, { method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "video/mp4", Accept: "application/json", "Accept-Encoding": "identity", "X-Deshdak-Video-Sha256": originalSha256 }, body: new Uint8Array(bytes), signal: controller.signal, redirect: "error", cache: "no-store" });
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") || ![null, "identity"].includes(response.headers.get("content-encoding")) || !response.body) throw new Error("Unconfirmed processor response");
      reader = response.body.getReader();
      const aborted = new Promise<never>((_, reject) => {
        const cancel = () => reject(new Error("Aborted"));
        if (controller.signal.aborted) cancel();
        else { controller.signal.addEventListener("abort", cancel, { once: true }); removeAbort = () => controller.signal.removeEventListener("abort", cancel); }
      });
      const chunks: Buffer[] = []; let size = 0;
      for (;;) {
        const item = await Promise.race([reader.read(), aborted]); if (item.done) break;
        size += item.value.byteLength; if (size > 13 * 1024 * 1024) throw new Error("Processor response too large");
        chunks.push(Buffer.from(item.value));
      }
      const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      if (!keys(result, ["profile", "originalSha256", "durationMs", "width", "height", "audio", "video", "poster"]) || result.profile !== "inspection-video-v1" || result.originalSha256 !== originalSha256 || !Number.isInteger(result.durationMs) || Number(result.durationMs) < 200 || Number(result.durationMs) > 60_000 || !Number.isInteger(result.width) || Number(result.width) < 16 || Number(result.width) > 1280 || !Number.isInteger(result.height) || Number(result.height) < 16 || Number(result.height) > 720 || typeof result.audio !== "boolean") throw new Error("Unconfirmed video profile");
      return { profile: "inspection-video-v1" as const, originalSha256, durationMs: Number(result.durationMs), width: Number(result.width), height: Number(result.height), audio: result.audio, video: artifact(result.video, "video/mp4", videoMaximum), poster: artifact(result.poster, "image/jpeg", posterMaximum) };
    } catch { throw new Error("PRIVATE_VIDEO_PROCESSING_FAILED"); }
    finally { clearTimeout(timer); controller.abort(); removeAbort?.(); void reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  };
}
