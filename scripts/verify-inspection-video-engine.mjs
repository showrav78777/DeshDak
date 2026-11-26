import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
let docker = "docker";
if (process.platform === "darwin") { try { await access("/Applications/Docker.app/Contents/Resources/bin/docker"); docker = "/Applications/Docker.app/Contents/Resources/bin/docker"; } catch { /* Use PATH. */ } }
const env = { ...process.env, ...(docker.startsWith("/") ? { PATH: `${dirname(docker)}:${process.env.PATH ?? ""}` } : {}) };
function run(args, { timeout = 120_000, allowFailure = false } = {}) {
  const result = spawnSync(docker, args, { env, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`Owned real-video acceptance failed (${args[0]}): ${output.split("\n").filter(line => line.length < 1000).slice(-20).join("\n")}`);
  return { status: result.status, output: output.trim() };
}
async function running(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(docker, args, { env, stdio: ["ignore", "inherit", "inherit"] });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 420_000);
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error("Owned real-video acceptance container failed. No gate was waived.")); });
  });
}
const contextHost = () => JSON.parse(run(["context", "inspect", ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []), "--format", "{{json .Endpoints.docker.Host}}"] ).output);
const host = process.env.DOCKER_CONTEXT ? contextHost() : process.env.DOCKER_HOST || contextHost();
if (!/^(?:unix|npipe):/.test(host)) throw new Error("Real video acceptance requires a local Docker daemon.");
const marker = randomBytes(8).toString("hex"), prefix = `deshdak-video-engine-${marker}`;
const appImage = `${prefix}:processor`, engineImage = `${prefix}:engine`, engine = `${prefix}-clamd`;
const internal = `${prefix}-private`, egress = `${prefix}-definitions`, containers = [], networks = [], images = [];
const directory = await mkdtemp(join(tmpdir(), "deshdak-video-engine-"));
try {
  const tokenFile = join(directory, "processor.env");
  await writeFile(tokenFile, `VIDEO_PROCESSOR_TOKEN=${randomBytes(32).toString("hex")}\nCLAMD_HOST=engine.internal\nCLAMD_PORT=3310\n`, { mode: 0o600, flag: "wx" });
  const signatureFile = join(directory, "synthetic.ndb");
  await writeFile(signatureFile, `DeshDakSyntheticAcceptance:0:*:${Buffer.from("DESHDAK-HARMLESS-VIDEO-ACCEPTANCE-MARKER-V1").toString("hex")}\n`, { mode: 0o644, flag: "wx" });
  console.log("Building owned real-video processor/ClamAV images. All fixtures are synthetic; no account/provider credentials are used.");
  run(["build", "--target", "engine-acceptance", "-f", "services/inspection-video/Dockerfile", "-t", appImage, "."], { timeout: 300_000 }); images.push(appImage);
  run(["build", "--platform", "linux/amd64", "-f", "services/media-scanner/Engine.Dockerfile", "-t", engineImage, "."], { timeout: 300_000 }); images.push(engineImage);
  console.log(`Processor image: ${run(["image", "inspect", appImage, "--format", "{{.Id}}"] ).output}`);
  console.log(`Engine image: ${run(["image", "inspect", engineImage, "--format", "{{.Id}}"] ).output}`);
  run(["network", "create", "--internal", "--label", "deshdak.video-acceptance=true", internal]); networks.push(internal);
  run(["network", "create", "--label", "deshdak.video-acceptance=true", egress]); networks.push(egress);
  containers.push(engine);
  run(["create", "--platform", "linux/amd64", "--name", engine, "--label", "deshdak.video-acceptance=true", "--network", egress, "--env-file", "services/inspection-video/clamd.env", "--memory", "4g", "--cpus", "2", "--pids-limit", "128", "--security-opt", "no-new-privileges:true", engineImage]);
  run(["cp", signatureFile, `${engine}:/var/lib/clamav/deshdak-acceptance.ndb`]);
  run(["network", "connect", "--alias", "engine.internal", internal, engine]);
  run(["start", engine]);
  const options = name => ["run", "--name", name, "--label", "deshdak.video-acceptance=true", "--network", internal, "--env-file", tokenFile, "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=134217728,mode=1777", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--memory", "1g", "--cpus", "2", "--pids-limit", "64", "--no-healthcheck"];
  const app = `${prefix}-verify`; containers.push(app);
  await running([...options(app), appImage]);
  assert.equal(run(["inspect", app, "--format", "{{.State.ExitCode}}"] ).output, "0");
  run(["stop", "--time", "10", engine]);
  const outage = `${prefix}-outage`; containers.push(outage);
  await running([...options(outage), "--env", "VIDEO_ENGINE_ACCEPTANCE_MODE=outage", appImage]);
  console.log("Owned real-engine video acceptance and outage checks passed. TLS, deployment image scanning/signing and application integration remain unverified.");
} catch (error) {
  if (containers.includes(engine)) console.error(run(["logs", "--tail", "15", engine], { allowFailure: true }).output);
  throw error;
} finally {
  let failed = false;
  for (const name of containers.reverse()) { run(["rm", "-f", "-v", name], { allowFailure: true }); if (run(["inspect", name], { allowFailure: true }).status === 0) failed = true; }
  for (const network of networks.reverse()) if (run(["network", "rm", network], { allowFailure: true }).status !== 0) failed = true;
  for (const image of images.reverse()) { run(["image", "rm", image], { allowFailure: true }); if (run(["image", "inspect", image], { allowFailure: true }).status === 0) failed = true; }
  await rm(directory, { recursive: true, force: true });
  if (failed) throw new Error("Owned real-video acceptance resources require cleanup.");
  console.log("Removed owned real-video containers, anonymous volumes, networks, image tags and temporary token file. Shared bases/build cache remain.");
}
