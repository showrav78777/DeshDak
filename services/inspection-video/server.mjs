import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { clamdCommand, requireFreshDefinitions } from "../media-scanner/clamd.mjs";
import { createInspectionVideoProcessor, digest, VideoProcessingError, videoCommand, videoLimits } from "./processor.mjs";

export function inspectionVideoConfiguration(env = process.env) {
  const token = env.VIDEO_PROCESSOR_TOKEN?.trim(), host = env.CLAMD_HOST ?? "clamd", port = Number(env.CLAMD_PORT ?? "3310");
  if (!token || token.length < 32 || token.length > 256 || /[\s\u0000-\u001f\u007f]/.test(token) || !/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Private video configuration is invalid.");
  return { token, host, port };
}
export function createInspectionVideoServer(config) {
  let active = false;
  const tokenDigest = value => createHash("sha256").update(value).digest();
  const processor = createInspectionVideoProcessor(async (bytes, signal) => {
    const engine = { host: config.host, port: config.port, signal };
    try {
      requireFreshDefinitions(await clamdCommand(engine, "VERSION"));
      const result = await clamdCommand(engine, "INSTREAM", bytes);
      if (/^stream: [^\r\n\0]{1,512} FOUND$/.test(result)) throw new VideoProcessingError("VIDEO_REJECTED", 422);
      if (result !== "stream: OK") throw new VideoProcessingError();
    } catch (error) { if (error instanceof VideoProcessingError) throw error; throw new VideoProcessingError(); }
  });
  function reply(response, status, body) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Connection": "close" });
    response.end(JSON.stringify(body));
  }
  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    if (request.method === "GET" && request.url === "/health/live") { reply(response, 200, { status: "up" }); return; }
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || authorization.length > 512 || !timingSafeEqual(tokenDigest(authorization), tokenDigest(`Bearer ${config.token}`))) { reply(response, 401, { error: "UNAUTHORIZED" }); return; }
    const ready = request.method === "GET" && request.url === "/health/ready";
    if (!ready && !(request.method === "POST" && request.url === "/process")) { reply(response, 404, { error: "NOT_FOUND" }); return; }
    if (active) { response.setHeader("Retry-After", "5"); reply(response, 503, { error: "VIDEO_PROCESSOR_BUSY" }); return; }
    if (!ready) {
      if (request.headers["content-type"] !== "video/mp4" || ![undefined, "identity"].includes(request.headers["content-encoding"])) { reply(response, 415, { error: "UNSUPPORTED_MEDIA" }); return; }
      const length = request.headers["content-length"];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > videoLimits.inputBytes)) { reply(response, 413, { error: "VIDEO_TOO_LARGE" }); return; }
      if (!/^[a-f0-9]{64}$/.test(request.headers["x-deshdak-video-sha256"] ?? "")) { reply(response, 422, { error: "VIDEO_DIGEST_REQUIRED" }); return; }
    }
    active = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ready ? 4000 : 90_000);
    const abort = () => controller.abort(), closed = () => { if (!response.writableEnded) controller.abort(); };
    request.on("aborted", abort); response.on("close", closed);
    try {
      if (ready) {
        requireFreshDefinitions(await clamdCommand({ host: config.host, port: config.port, signal: controller.signal }, "VERSION"));
        await videoCommand("/usr/bin/ffmpeg", ["-version"], controller.signal, 2000);
        await videoCommand("/usr/bin/ffprobe", ["-version"], controller.signal, 2000);
        if (!processor.ready()) throw new VideoProcessingError();
        reply(response, 200, { status: "ready" }); return;
      }
      const chunks = []; let size = 0, removeAbort;
      const cancelled = new Promise((_, reject) => {
        const cancel = () => reject(new VideoProcessingError());
        if (controller.signal.aborted) cancel();
        else { controller.signal.addEventListener("abort", cancel, { once: true }); removeAbort = () => controller.signal.removeEventListener("abort", cancel); }
      });
      try {
        const iterator = request[Symbol.asyncIterator]();
        for (;;) {
          const item = await Promise.race([iterator.next(), cancelled]); if (item.done) break;
          size += item.value.length; if (size > videoLimits.inputBytes) throw new VideoProcessingError("VIDEO_TOO_LARGE", 413);
          chunks.push(item.value);
        }
      } finally { removeAbort?.(); }
      const bytes = Buffer.concat(chunks);
      if (digest(bytes) !== request.headers["x-deshdak-video-sha256"]) throw new VideoProcessingError("VIDEO_DIGEST_MISMATCH", 422);
      const result = await processor(bytes, controller.signal);
      reply(response, 200, result);
    } catch (error) { reply(response, error instanceof VideoProcessingError ? error.status : 503, { error: error instanceof VideoProcessingError ? error.message : "VIDEO_PROCESSING_UNAVAILABLE" }); }
    finally {
      clearTimeout(timer); controller.abort(); request.removeListener("aborted", abort); response.removeListener("close", closed); active = false;
    }
  });
  server.headersTimeout = 5000; server.requestTimeout = 95_000; server.keepAliveTimeout = 1000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Use a non-privileged video processor port.");
  const server = createInspectionVideoServer(inspectionVideoConfiguration());
  server.listen(port, "0.0.0.0", () => console.log("Private video processor listening. Uploads and credentials are not logged."));
  const stop = () => { server.close(); setTimeout(() => server.closeAllConnections(), 91_000).unref(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}
