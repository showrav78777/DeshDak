import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { dirname } from "node:path";

let docker = "docker";
if (process.platform === "darwin") { try { await access("/Applications/Docker.app/Contents/Resources/bin/docker"); docker = "/Applications/Docker.app/Contents/Resources/bin/docker"; } catch { /* Use PATH. */ } }
function run(args, { timeout = 120_000, allowFailure = false } = {}) {
  const env = { ...process.env, ...(docker.startsWith("/") ? { PATH: `${dirname(docker)}:${process.env.PATH ?? ""}` } : {}) };
  const result = spawnSync(docker, args, { encoding: "utf8", env, timeout, maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`Owned video acceptance failed (${args[0]}): ${output.split("\n").filter(line => line.length < 1000).slice(-20).join("\n")}`);
  return { status: result.status, output: output.trim() };
}
const contextHost = () => JSON.parse(run(["context", "inspect", ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []), "--format", "{{json .Endpoints.docker.Host}}"] ).output);
const host = process.env.DOCKER_CONTEXT ? contextHost() : process.env.DOCKER_HOST || contextHost();
if (!/^(?:unix|npipe):/.test(host)) throw new Error("Video acceptance requires a local Docker daemon.");
const marker = randomBytes(8).toString("hex"), image = `deshdak-video-test-${marker}:acceptance`, container = `deshdak-video-test-${marker}`;
let built = false, created = false;
try {
  console.log("Building the private video component; no provider credentials or customer files are used.");
  run(["build", "--target", "acceptance", "-f", "services/inspection-video/Dockerfile", "-t", image, "."], { timeout: 300_000 }); built = true;
  const inspected = JSON.parse(run(["image", "inspect", image, "--format", "{{json .Config}}"]).output);
  if (inspected.User !== "node") throw new Error("Video component must run as the non-root node user.");
  console.log(`Acceptance image: ${run(["image", "inspect", image, "--format", "{{.Id}}"] ).output}`);
  created = true;
  const result = run(["run", "--name", container, "--label", "deshdak.video-acceptance=true", "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=134217728,mode=1777", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "64", "--memory", "1g", "--cpus", "2", "--no-healthcheck", image], { timeout: 240_000 });
  console.log(result.output.split("\n").filter(line => line.length < 1000).join("\n"));
} finally {
  let failed = false;
  if (created) { run(["rm", "-f", "-v", container], { allowFailure: true }); if (run(["inspect", container], { allowFailure: true }).status === 0) failed = true; }
  if (built) { run(["image", "rm", image], { allowFailure: true }); if (run(["image", "inspect", image], { allowFailure: true }).status === 0) failed = true; }
  if (failed) throw new Error("Owned video acceptance resources require cleanup.");
  console.log("Removed the owned video container and image tag. Shared base images/build caches remain. No production video route was activated.");
}
