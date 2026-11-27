import "server-only";
import { prisma } from "@/lib/prisma";
import { privateStorageConfigSchema } from "./photos";
import { createPrivateVideoArtifactStore } from "./video-artifacts";
import { createPrivateInspectionVideoProcessor } from "./video-processing";
import { createPrivateVideoUploadQueue } from "./video-upload-queue";

let runtime: ReturnType<typeof buildRuntime> | undefined;

function buildRuntime() {
  const env = process.env;
  if (env.PRIVATE_VIDEO_ENABLED !== "true") return null;

  const storage = privateStorageConfigSchema.safeParse({
    bucket: env.PRIVATE_VIDEO_BUCKET,
    region: env.PRIVATE_VIDEO_REGION,
    expectedOwner: env.PRIVATE_VIDEO_EXPECTED_OWNER,
    kmsKeyArn: env.PRIVATE_VIDEO_KMS_KEY_ARN,
  });
  const keys = [
    env.PRIVATE_VIDEO_STAGING_KEY,
    env.PRIVATE_VIDEO_ORIGINAL_KEY,
    env.PRIVATE_VIDEO_NORMALIZED_KEY,
    env.PRIVATE_VIDEO_POSTER_KEY,
  ];
  if (!storage.success || keys.some(key => !key || !/^[a-f0-9]{64}$/.test(key)) || new Set(keys).size !== keys.length) return null;

  try {
    const [staging, original, video, poster] = keys.map(key => Buffer.from(key!, "hex"));
    const processor = createPrivateInspectionVideoProcessor({
      url: env.PRIVATE_VIDEO_PROCESSOR_URL ?? "",
      token: env.PRIVATE_VIDEO_PROCESSOR_TOKEN ?? "",
    });
    const store = createPrivateVideoArtifactStore({ config: storage.data, keys: { original, video, poster } });
    return { store, queue: createPrivateVideoUploadQueue(prisma, store, processor, staging) };
  } catch {
    return null;
  }
}

/** Reuse the private storage client for the lifetime of the server process. */
export function privateVideoRuntime() {
  if (runtime === undefined) runtime = buildRuntime();
  return runtime;
}
