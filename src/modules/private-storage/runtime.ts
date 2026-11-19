import "server-only";
import { validatePrivatePhotoRuntimeEnvironment } from "../../../scripts/lib/private-photo-runtime-config.mjs";
import { createPrivatePhotoStore } from "./photos";
import { createPrivatePhotoScanner } from "./photo-scanner";

export function privatePhotoStorageConfigured() {
  const result = validatePrivatePhotoRuntimeEnvironment(process.env);
  return Boolean(result.ok && result.enabled && result.configuration);
}

export function privatePhotoRuntime() {
  const result = validatePrivatePhotoRuntimeEnvironment(process.env);
  if (!result.ok || !result.enabled || !result.configuration) return null;
  return {
    store: createPrivatePhotoStore({ config: result.configuration.storage, keys: result.configuration.keys }),
    scan: createPrivatePhotoScanner(result.configuration.scanner),
  };
}
