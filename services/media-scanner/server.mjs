import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { clamdCommand, requireFreshDefinitions } from "./clamd.mjs";

const MAXIMUM_BYTES = 8 * 1024 * 1024;
function authenticated(value, token) {
  if (typeof value !== "string" || value.length > 512) return false;
  const digest = input => createHash("sha256").update(input).digest();
  return timingSafeEqual(digest(value), digest(`Bearer ${token}`));
}
export function scannerConfiguration(env = process.env) {
  const token = env.SCANNER_TOKEN?.trim();
  if (!token || token.length < 32 || token.length > 256 || /\s/.test(token)) throw new Error("SCANNER_TOKEN must be an independent secret of 32–256 non-whitespace characters.");
  const host = env.CLAMD_HOST ?? "clamd"; const port = Number(env.CLAMD_PORT ?? "3310");
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid private scanner engine address.");
  return { token, host, port };
}
function supportedWebsiteImage(bytes) {
  return bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    || bytes.length >= 12 && bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
}
export function createScannerServer(config) {
  let active = 0;
  function respond(response, status, body) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Connection": "close" });
    response.end(JSON.stringify(body));
  }
  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    if (request.method === "GET" && request.url === "/health/live") { respond(response, 200, { status: "up" }); return; }
    if (!authenticated(request.headers.authorization, config.token)) { respond(response, 401, { status: "unauthorized" }); return; }
    const ready = request.method === "GET" && request.url === "/health/ready";
    if (!ready && !(request.method === "POST" && request.url === "/scan")) { respond(response, 404, { status: "not_found" }); return; }
    if (active >= 2) { response.setHeader("Retry-After", "5"); respond(response, 503, { status: "busy" }); return; }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10_000);
    const aborted = () => controller.abort();
    const closed = () => { if (!response.writableEnded) controller.abort(); };
    request.on("aborted", aborted); response.on("close", closed);
    active++;
    try {
      if (!ready) {
        if (request.headers["content-type"]?.toLowerCase() !== "application/octet-stream" || ![undefined,"identity"].includes(request.headers["content-encoding"])) { respond(response, 415, { status: "invalid_upload" }); return; }
        const length = request.headers["content-length"];
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAXIMUM_BYTES)) { respond(response, 413, { status: "too_large" }); return; }
      }
      const engine = { host: config.host, port: config.port, signal: controller.signal };
      requireFreshDefinitions(await clamdCommand(engine, "VERSION"));
      if (ready) { respond(response, 200, { status: "ready" }); return; }
      const chunks = []; let size = 0;
      let removeAbort;
      const cancelled = new Promise((_, reject) => {
        const cancel = () => reject(new Error("Upload unavailable"));
        if (controller.signal.aborted) cancel();
        else { controller.signal.addEventListener("abort", cancel, { once: true }); removeAbort = () => controller.signal.removeEventListener("abort", cancel); }
      });
      try {
        const iterator = request[Symbol.asyncIterator]();
        for (;;) {
          const part = await Promise.race([iterator.next(), cancelled]);
          if (part.done) break;
          size += part.value.length;
          if (size > MAXIMUM_BYTES) { respond(response, 413, { status: "too_large" }); return; }
          chunks.push(part.value);
        }
      } finally { removeAbort?.(); }
      if (!size) { respond(response, 422, { status: "empty_upload" }); return; }
      const bytes = Buffer.concat(chunks);
      const requestedDigest = request.headers["x-deshdak-scan-sha256"];
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (requestedDigest !== undefined && (typeof requestedDigest !== "string" || !/^[a-f0-9]{64}$/.test(requestedDigest) || requestedDigest !== digest)) { respond(response,400,{ status: "digest_mismatch" }); return; }
      const verdict = await clamdCommand(engine, "INSTREAM", bytes);
      // This gateway is exclusively for website images. The application must
      // additionally decode/re-encode before storage. Do not trust an engine's
      // clean verdict for archives or other unsupported file formats.
      if (verdict === "stream: OK" && !supportedWebsiteImage(bytes)) respond(response, 415, { status: "unsupported_media" });
      else if (verdict === "stream: OK") respond(response, 200, requestedDigest === undefined ? { status: "clean" } : { status: "clean", sha256: digest });
      else if (/^stream: [^\r\n\0]{1,512} FOUND$/.test(verdict)) respond(response, 422, { status: "infected" });
      else respond(response, 503, { status: "unavailable" });
    } catch { respond(response, 503, { status: "unavailable" }); }
    finally {
      clearTimeout(deadline); controller.abort();
      request.removeListener("aborted", aborted); response.removeListener("close", closed);
      active--;
    }
  });
  server.headersTimeout = 5_000; server.requestTimeout = 12_000; server.keepAliveTimeout = 1_000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be a non-privileged port.");
  const server = createScannerServer(scannerConfiguration());
  server.listen(port, "0.0.0.0", () => console.log("Media scanner listening; no file or credential logging is enabled."));
  const stop = () => { server.close(); setTimeout(() => { server.closeAllConnections(); }, 11_000).unref(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}
