import assert from "node:assert/strict";
import { createServer as tcpServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { createInspectionVideoServer, inspectionVideoConfiguration } from "./server.mjs";
import { createInspectionVideoProcessor, digest, videoCommand, videoLimits } from "./processor.mjs";

let mode = "clean", scans = [], engineEntered, engineHeld;
const engine = tcpServer(socket => {
  let buffer = Buffer.alloc(0), command, chunks = [], size = 0;
  socket.on("error", () => {});
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!command) {
      const end = buffer.indexOf(0); if (end < 0) return;
      command = buffer.subarray(0, end).toString(); buffer = buffer.subarray(end + 1);
      if (command === "zVERSION") { socket.end(`ClamAV test/1/${new Date(Date.now() - (mode === "stale" ? 72 * 3600000 : 0)).toUTCString().replace(/ GMT$/, "")}\0`); return; }
      if (command !== "zINSTREAM") { socket.destroy(); return; }
    }
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0); if (length > 65536) { socket.destroy(); return; }
      if (buffer.length < length + 4) return;
      const value = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
      if (!length) {
        const bytes = Buffer.concat(chunks); scans.push({ sha256: digest(bytes), length: bytes.length });
        if (mode === "hold") { engineEntered(); void engineHeld.then(() => { if (!socket.destroyed) socket.end("stream: OK\0"); }); return; }
        const infected = mode === "infected-input" || mode === "infected-video" && scans.length === 2 || mode === "infected-poster" && scans.length === 3;
        socket.end(`${infected ? "stream: Synthetic.Test FOUND" : mode === "engine-error" ? "UNCONFIRMED" : "stream: OK"}\0`); return;
      }
      size += length; if (size > videoLimits.inputBytes) { socket.destroy(); return; }
      chunks.push(value);
    }
  });
});
await new Promise(resolve => engine.listen(0, "127.0.0.1", resolve));
const token = randomBytes(32).toString("hex"), config = { token, host: "127.0.0.1", port: engine.address().port };
const server = createInspectionVideoServer(config);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const directory = await mkdtemp(join(tmpdir(), "inspection-fixtures-"));
const jobDirs = async () => (await readdir(tmpdir())).filter(name => name.startsWith("deshdak-video-"));
const command = args => videoCommand("/usr/bin/ffmpeg", ["-nostdin", "-hide_banner", "-v", "error", "-threads", "1", "-filter_threads", "1", ...args], AbortSignal.timeout(20_000), 20_000);
async function post(bytes, headers = {}, path = "/process") {
  return fetch(`${origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "X-Deshdak-Video-Sha256": digest(bytes), ...headers }, body: bytes, signal: AbortSignal.timeout(90_000) });
}
try {
  assert.equal(process.getuid(), 1000);
  for (const env of [{}, { VIDEO_PROCESSOR_TOKEN: "short" }, { VIDEO_PROCESSOR_TOKEN: token, CLAMD_HOST: "https://invalid" }]) assert.throws(() => inspectionVideoConfiguration(env));
  const fixture = join(directory, "input.mp4");
  await command(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-threads", "1", "-c:a", "aac", "-metadata", "title=PRIVATE-VIDEO-METADATA", "-metadata", "location=+23.8103+090.4125/", "-metadata:s:v:0", "handler_name=PRIVATE-VIDEO-METADATA", "-y", fixture]);
  const bytes = await readFile(fixture);
  assert.equal((await fetch(`${origin}/health/live`)).status, 200);
  assert.equal((await fetch(`${origin}/health/ready`)).status, 401);
  assert.equal((await fetch(`${origin}/health/ready`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  for (const [headers, expected, path] of [[{ Authorization: "Bearer wrong" }, 401], [{ "Content-Type": "application/json" }, 415], [{ "Content-Encoding": "gzip" }, 415], [{ "X-Deshdak-Video-Sha256": "0".repeat(64) }, 422], [{ "X-Deshdak-Video-Sha256": "" }, 422], [{}, 404, "/process?url=https://example.invalid/private"]]) {
    scans = []; assert.equal((await post(bytes, headers, path)).status, expected); assert.equal(scans.length, 0);
  }
  scans = []; assert.equal((await post(Buffer.alloc(videoLimits.inputBytes + 1))).status, 413); assert.equal(scans.length, 0);
  assert.equal((await post(Buffer.from("https://example.invalid/not-a-video"))).status, 422);
  assert.equal((await post(Buffer.alloc(0))).status, 422);
  const good = await post(bytes); assert.equal(good.status, 200); assert(good.headers.get("cache-control").includes("no-store"));
  const result = await good.json(), video = Buffer.from(result.video.bytesBase64, "base64"), poster = Buffer.from(result.poster.bytesBase64, "base64");
  assert.equal(result.originalSha256, digest(bytes)); assert.equal(result.video.sha256, digest(video)); assert.equal(result.poster.sha256, digest(poster));
  assert.equal(result.audio, true); assert.equal(scans.length, 3); assert.deepEqual(scans.map(scan => scan.sha256), [digest(bytes), digest(video), digest(poster)]);
  assert(video.length <= videoLimits.videoBytes && poster.length <= videoLimits.posterBytes);
  assert(!video.includes(Buffer.from("PRIVATE-VIDEO-METADATA")) && !video.includes(Buffer.from("+23.8103")));
  assert.equal(poster.toString("hex", 0, 3), "ffd8ff");
  const normalized = join(directory, "normalized.mp4"); await writeFile(normalized, video);
  const metadata = JSON.parse((await videoCommand("/usr/bin/ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", normalized], AbortSignal.timeout(10_000))).toString());
  assert.equal(metadata.streams.find(stream => stream.codec_type === "video").codec_name, "h264");
  assert.equal(metadata.streams.find(stream => stream.codec_type === "audio").codec_name, "aac");
  assert(!JSON.stringify(metadata).includes("PRIVATE-VIDEO-METADATA")); assert.equal(Number(metadata.format.duration) <= 60, true);
  for (const failure of ["infected-input", "infected-video", "infected-poster", "engine-error", "stale"]) {
    mode = failure; scans = []; const response = await post(bytes); assert.equal(response.status, failure.startsWith("infected") ? 422 : 503);
    const body = await response.text(); assert(!body.includes("Synthetic.Test") && !body.includes("/tmp") && !body.includes("bytesBase64")); assert.deepEqual(await jobDirs(), []);
  }
  mode = "clean";
  const fake = Buffer.alloc(32); fake.writeUInt32BE(32); fake.write("ftypisom", 4);
  assert.equal((await post(fake)).status, 422); assert.deepEqual(await jobDirs(), []);
  const long = join(directory, "long.mp4");
  await command(["-f", "lavfi", "-i", "color=c=black:s=32x32:r=1", "-t", "61", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-y", long]);
  assert.equal((await post(await readFile(long))).status, 422);
  let releaseEngine, enteredEngine;
  engineHeld = new Promise(resolve => { releaseEngine = resolve; });
  enteredEngine = new Promise(resolve => { engineEntered = resolve; });
  mode = "hold";
  const disconnected = new AbortController();
  const pendingHttp = fetch(`${origin}/process`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "X-Deshdak-Video-Sha256": digest(bytes) }, body: bytes, signal: disconnected.signal }).then(() => false, () => true);
  try {
    await Promise.race([enteredEngine, new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error("Expected held input scan")), 5000); timeout.unref(); })]);
    const busy = await post(bytes); assert.equal(busy.status, 503); assert.equal(busy.headers.get("retry-after"), "5");
    disconnected.abort(); assert.equal(await pendingHttp, true);
  } finally { disconnected.abort(); mode = "clean"; releaseEngine(); }
  let recovered = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await fetch(`${origin}/health/ready`, { headers: { Authorization: `Bearer ${token}` } })).status === 200) { recovered = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(recovered, "HTTP cancellation did not release admission");
  assert.deepEqual(await jobDirs(), []);
  let enter, release; const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
  let first = true;
  const busyProcessor = createInspectionVideoProcessor(async () => { if (first) { first = false; enter(); await held; } });
  const running = busyProcessor(bytes, AbortSignal.timeout(90_000)); await entered;
  try { await assert.rejects(() => busyProcessor(bytes), /VIDEO_PROCESSOR_BUSY/); } finally { release(); }
  await running;
  const abort = new AbortController(); const abortProcessor = createInspectionVideoProcessor(async () => { setTimeout(() => abort.abort(), 10); });
  await assert.rejects(() => abortProcessor(bytes, abort.signal)); assert.deepEqual(await jobDirs(), []);
  const processes = (await readdir("/proc")).filter(name => /^\d+$/.test(name));
  for (const processId of processes) { let comm; try { comm = await readFile(`/proc/${processId}/comm`, "utf8"); } catch { continue; } assert(!/^(ffmpeg|ffprobe)\n$/.test(comm), "Cancelled child survived job completion"); }
  const source = (await readFile(new URL("../test-client.ts", import.meta.url), "utf8")).replace('import "server-only";', "");
  const { createPrivateInspectionVideoProcessor } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
  const endpoint = { url: "https://private-video.invalid/process", token };
  for (const url of ["http://private-video.invalid/process", "https://user:pass@private-video.invalid/process", "https://private-video.invalid/process?url=x"]) assert.throws(() => createPrivateInspectionVideoProcessor({ ...endpoint, url }), /PRIVATE_VIDEO_PROCESSOR_UNAVAILABLE/);
  const client = createPrivateInspectionVideoProcessor(endpoint, (_url, options) => fetch(`${origin}/process`, options));
  assert((await client(bytes)).video.bytes.equals(video));
  for (const patch of [{ originalSha256: "0".repeat(64) }, { width: 99999 }, { extra: "unexpected" }, { video: { ...result.video, sha256: "0".repeat(64) } }, { poster: { ...result.poster, bytesBase64: "invalid=" } }]) {
    const forged = createPrivateInspectionVideoProcessor(endpoint, async () => Response.json({ ...result, ...patch })); await assert.rejects(() => forged(bytes), /PRIVATE_VIDEO_PROCESSING_FAILED/);
  }
  assert.deepEqual(await jobDirs(), []);
  console.log("Private inspection video component passed: actual FFmpeg H264/AAC conversion and JPEG poster, input/output/poster scan ordering, metadata removal, duration/size/type/digest/auth bounds, infected/outage/stale rejection, concurrency/cancellation and temporary cleanup, strict HTTPS client and tamper rejection. ClamAV replies were simulated. No web route, storage/evidence binding or production activation was added.");
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => engine.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
