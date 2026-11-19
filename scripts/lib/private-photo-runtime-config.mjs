import { validatePrivatePhotoRescanEnvironment } from "./private-photo-rescan-config.mjs";

// Intake and delivery share the approved namespace, encryption keys and scanner.
// Rescanning retains its independent activation switch.
export function validatePrivatePhotoRuntimeEnvironment(env) {
  const result = validatePrivatePhotoRescanEnvironment({
    ...env,
    PRIVATE_PHOTO_RESCAN_ENABLED: env.PRIVATE_PHOTO_STORAGE_ENABLED,
  });
  return {
    ...result,
    errors: result.errors.map(error => error.replaceAll("PRIVATE_PHOTO_RESCAN_ENABLED", "PRIVATE_PHOTO_STORAGE_ENABLED")),
  };
}
