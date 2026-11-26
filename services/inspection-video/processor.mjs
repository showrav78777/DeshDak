import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, chmod, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const videoLimits = Object.freeze({ inputBytes: 30 * 1024 * 1024, videoBytes: 8 * 1024 * 1024, posterBytes: 512 * 1024, durationSeconds: 60 });
export class VideoProcessingError extends Error {
  constructor(code = "VIDEO_PROCESSING_UNAVAILABLE", status = 503) { super(code); this.status = status; }
}
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const rejected = () => new VideoProcessingError("VIDEO_REJECTED", 422);
const inputOptions = ["-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", "-max_streams", "4", "-probesize", "31457280", "-analyzeduration", "5000000"];

// Fixed executables, no shell or inherited provider credentials. Wait for close
// after cancellation before deleting the job directory or admitting another job.
export function videoCommand(binary, args, signal, timeoutMs = 10_000) {
  if (!["/usr/bin/ffmpeg", "/usr/bin/ffprobe"].includes(binary) || signal?.aborted) return Promise.reject(new VideoProcessingError());
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" } });
    const chunks = []; let size = 0, failed = false;
    const stop = () => { failed = true; child.kill("SIGKILL"); };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    child.stdout.on("data", chunk => { size += chunk.length; if (size > 64 * 1024) stop(); else chunks.push(chunk); });
    child.stderr.on("data", chunk => { size += chunk.length; if (size > 64 * 1024) stop(); });
    child.on("error", () => { failed = true; });
    child.on("close", code => {
      clearTimeout(timer); signal?.removeEventListener("abort", stop);
      if (failed || code !== 0 || signal?.aborted) reject(new VideoProcessingError());
      else resolve(Buffer.concat(chunks));
    });
  });
}
async function probe(path, signal) {
  try {
    const body = await videoCommand("/usr/bin/ffprobe", ["-v", "error", ...inputOptions, "-show_streams", "-show_format", "-of", "json", path], signal);
    const value = JSON.parse(body.toString("utf8")), streams = value.streams;
    if (!Array.isArray(streams) || streams.length > 4 || streams.some(stream => !["video", "audio"].includes(stream.codec_type))) throw rejected();
    const videos = streams.filter(stream => stream.codec_type === "video"), audios = streams.filter(stream => stream.codec_type === "audio");
    const video = videos[0], audio = audios[0], duration = Number(value.format?.duration);
    const ratio = String(video?.avg_frame_rate ?? "").split("/").map(Number), fps = ratio[0] / ratio[1];
    if (videos.length !== 1 || audios.length > 1 || !["h264", "hevc"].includes(video?.codec_name) || audio && (!["aac", "mp3"].includes(audio.codec_name) || !Number.isInteger(audio.channels) || audio.channels < 1 || audio.channels > 2 || Number(audio.sample_rate) < 8000 || Number(audio.sample_rate) > 96000) || !Number.isFinite(duration) || duration < 0.2 || duration > videoLimits.durationSeconds || !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 16 || video.height < 16 || video.width > 1920 || video.height > 1920 || video.width * video.height > 1920 * 1080 || !Number.isFinite(fps) || fps <= 0 || fps > 60 || Number(video.nb_frames ?? 0) > 3600) throw rejected();
    return { duration, video, audio: audios[0] ?? null, raw: value };
  } catch (error) { if (signal?.aborted) throw new VideoProcessingError(); if (error instanceof VideoProcessingError && error.status === 422) throw error; throw rejected(); }
}
async function boundedFile(path, maximum) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > maximum) throw rejected();
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw rejected();
  return bytes;
}
/** Run only inside the isolated private processor, never inside the web process. */
export function createInspectionVideoProcessor(scan) {
  let active = false, broken = false;
  const processVideo = async (input, signal) => {
    if (broken) throw new VideoProcessingError();
    if (active) throw new VideoProcessingError("VIDEO_PROCESSOR_BUSY");
    if (!Buffer.isBuffer(input) || !input.length) throw rejected();
    if (input.length > videoLimits.inputBytes) throw new VideoProcessingError("VIDEO_TOO_LARGE", 413);
    if (input.length < 16 || input.toString("ascii", 4, 8) !== "ftyp" || input.readUInt32BE(0) < 16 || input.readUInt32BE(0) > Math.min(input.length, 4096) || !["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(input.toString("ascii", 8, 12))) throw rejected();
    if (signal?.aborted) throw new VideoProcessingError();
    active = true; let directory;
    try {
      const original = Buffer.from(input), originalSha256 = digest(original);
      await scan(original, signal);
      if (signal?.aborted || digest(original) !== originalSha256) throw new VideoProcessingError();
      directory = await mkdtemp(join(tmpdir(), "deshdak-video-")); await chmod(directory, 0o700);
      const source = join(directory, "input.mp4"), output = join(directory, "video.mp4"), poster = join(directory, "poster.jpg");
      await writeFile(source, original, { flag: "wx", mode: 0o600 });
      const before = await probe(source, signal);
      await videoCommand("/usr/bin/ffmpeg", ["-nostdin", "-hide_banner", "-v", "error", "-threads", "1", "-filter_threads", "1", ...inputOptions, "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1", "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-maxrate", "900k", "-bufsize", "1800k", "-pix_fmt", "yuv420p", "-threads", "1", "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-ar", "48000", "-t", "60", "-movflags", "+faststart", "-y", output], signal, 35_000);
      const after = await probe(output, signal);
      if (after.video.codec_name !== "h264" || after.video.pix_fmt !== "yuv420p" || after.video.width > 1280 || after.video.height > 720 || Math.abs(after.duration - before.duration) > 0.25 || Boolean(after.audio) !== Boolean(before.audio) || after.audio && after.audio.codec_name !== "aac") throw rejected();
      const video = await boundedFile(output, videoLimits.videoBytes);
      await scan(video, signal);
      await videoCommand("/usr/bin/ffmpeg", ["-nostdin", "-hide_banner", "-v", "error", "-threads", "1", "-filter_threads", "1", ...inputOptions, "-i", output, "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", "-vf", "scale=w='min(640,iw)':h='min(360,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-map_metadata", "-1", "-map_metadata:s", "-1", "-c:v", "mjpeg", "-q:v", "3", "-threads", "1", "-y", poster], signal);
      const thumbnail = await boundedFile(poster, videoLimits.posterBytes);
      if (thumbnail[0] !== 255 || thumbnail[1] !== 216 || thumbnail[2] !== 255) throw rejected();
      await scan(thumbnail, signal);
      if (signal?.aborted) throw new VideoProcessingError();
      return { profile: "inspection-video-v1", originalSha256, durationMs: Math.round(after.duration * 1000), width: after.video.width, height: after.video.height, audio: Boolean(after.audio), video: { mimeType: "video/mp4", sha256: digest(video), bytesBase64: video.toString("base64") }, poster: { mimeType: "image/jpeg", sha256: digest(thumbnail), bytesBase64: thumbnail.toString("base64") } };
    } catch (error) { if (error instanceof VideoProcessingError) throw error; throw new VideoProcessingError(); }
    finally {
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      catch { broken = true; throw new VideoProcessingError(); }
      finally { active = false; }
    }
  };
  processVideo.ready = () => !broken;
  return processVideo;
}
