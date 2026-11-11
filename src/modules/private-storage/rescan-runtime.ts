import "server-only";
import { validatePrivatePhotoRescanEnvironment } from "../../../scripts/lib/private-photo-rescan-config.mjs";
import { createPrivatePhotoStore } from "./photos";
import { createPrivatePhotoScanner } from "./photo-scanner";

export function privatePhotoRescanConfigured() {
  const result = validatePrivatePhotoRescanEnvironment(process.env);
  return Boolean(result.ok && result.enabled && result.configuration);
}
export function privatePhotoRescanRuntime() {
  const result = validatePrivatePhotoRescanEnvironment(process.env);
  if (!result.ok || !result.enabled || !result.configuration) return null;
  const configuration = result.configuration;
  return { store: createPrivatePhotoStore({ config: configuration.storage, keys: configuration.keys }), scan: createPrivatePhotoScanner(configuration.scanner) };
}
