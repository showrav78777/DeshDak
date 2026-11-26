import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInspectionVideoServer, inspectionVideoConfiguration } from "./server.mjs";
import { videoCommand, videoLimits, digest } from "./processor.mjs";
import { clamdCommand, requireFreshDefinitions } from "../media-scanner/clamd.mjs";

const config = inspectionVideoConfiguration(), server = createInspectionVideoServer(config);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const authorization = { Authorization: `Bearer ${config.token}` };
const directory = await mkdtemp(join(tmpdir(), "real-video-fixtures-"));
const engine = () => ({ host: config.host, port: config.port, signal: AbortSignal.timeout(35_000), timeoutMs: 30_000 });
async function post(bytes) {
  return fetch(`${origin}/process`, { method: "POST", headers: { ...authorization, "Content-Type": "video/mp4", "X-Deshdak-Video-Sha256": digest(bytes) }, body: bytes, signal: AbortSignal.timeout(95_000) });
}
try {
  assert.equal(process.getuid(), 1000);
  if (process.env.VIDEO_ENGINE_ACCEPTANCE_MODE === "outage") {
    assert.equal((await fetch(`${origin}/health/ready`, { headers: authorization, signal: AbortSignal.timeout(7000) })).status, 503);
    const fake = Buffer.alloc(32); fake.writeUInt32BE(32); fake.write("ftypisom", 4);
    const response = await post(fake); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "VIDEO_PROCESSING_UNAVAILABLE" });
    console.log("Real video engine outage passed: readiness and processing fail closed without returning derivatives.");
  } else {
    console.log("Waiting for the owned ClamAV engine and fresh definitions; freshness cannot be bypassed.");
    let ready = false;
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      try { ready = (await fetch(`${origin}/health/ready`, { headers: authorization, signal: AbortSignal.timeout(7000) })).status === 200; } catch { /* Engine may still be loading/updating. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    assert(ready, "Real video engine did not become ready with fresh definitions. Keep production video disabled.");
    const version = await clamdCommand(engine(), "VERSION"); requireFreshDefinitions(version);
    console.log(`Verified real engine: ${version}`);
    const fixture = join(directory, "input.mp4");
    await videoCommand("/usr/bin/ffmpeg", ["-nostdin", "-hide_banner", "-v", "error", "-threads", "1", "-filter_threads", "1", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", fixture], AbortSignal.timeout(20_000), 20_000);
    const clean = await readFile(fixture);
    for (const size of [clean.length, 9 * 1024 * 1024, videoLimits.inputBytes]) {
      const padding = size === clean.length ? Buffer.alloc(0) : Buffer.alloc(size - clean.length);
      if (padding.length) { padding.writeUInt32BE(padding.length); padding.write("free", 4); }
      const bytes = Buffer.concat([clean, padding]);
      assert.equal(await clamdCommand(engine(), "INSTREAM", bytes), "stream: OK", `Clean ${size}-byte input hit the real engine policy`);
      const response = await post(bytes); assert.equal(response.status, 200, `Clean ${size}-byte video failed real scan/processing`);
      const result = await response.json();
      assert.equal(result.originalSha256, digest(bytes)); assert.equal(result.profile, "inspection-video-v1");
      const video = Buffer.from(result.video.bytesBase64, "base64"), poster = Buffer.from(result.poster.bytesBase64, "base64");
      assert.equal(result.video.sha256, digest(video)); assert.equal(result.poster.sha256, digest(poster));
      assert(video.length <= videoLimits.videoBytes && poster.length <= videoLimits.posterBytes);
      assert.equal(await clamdCommand(engine(), "INSTREAM", video), "stream: OK");
      assert.equal(await clamdCommand(engine(), "INSTREAM", poster), "stream: OK");
      console.log(`Clean video accepted with real scans: ${size} input bytes; video and poster rechecked independently.`);
    }
    // Standard harmless antivirus test string, assembled only in memory. It is
    // neither an actual malware sample nor a customer file, and is never run.
    const antivirusTest = Buffer.from(["X5O!P%@AP[4", String.fromCharCode(92), "PZX54(P^)7CC)7}", "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""));
    assert.match(await clamdCommand(engine(), "INSTREAM", antivirusTest), / FOUND$/);
    // EICAR is file-format specific. This test-only engine also loads an
    // explicit harmless NDB marker to exercise FOUND on a valid MP4 container.
    const marker = Buffer.from("DESHDAK-HARMLESS-VIDEO-ACCEPTANCE-MARKER-V1");
    const box = Buffer.alloc(8); box.writeUInt32BE(marker.length + 8); box.write("free", 4);
    const flagged = Buffer.concat([clean, box, marker]);
    assert.match(await clamdCommand(engine(), "INSTREAM", flagged), / FOUND$/, "The embedded synthetic test-only marker was not detected by the real engine");
    const rejected = await post(flagged); assert.equal(rejected.status, 422); assert.deepEqual(await rejected.json(), { error: "VIDEO_REJECTED" });
    assert.equal((await post(Buffer.alloc(videoLimits.inputBytes + 1))).status, 413);
    console.log("Real ClamAV/FFmpeg video acceptance passed: fresh definitions, clean MP4/audio/poster, 9-MiB and exact 30-MiB inputs, harmless antivirus rejection and oversized rejection. No customer data, evidence binding or production activation.");
  }
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith("deshdak-video-")), []);
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
