import "server-only";
import sharp from "sharp";

export async function normalizePrivatePhoto(bytes: Buffer, mimeType: string, purpose: "identity" | "inspection") {
  const maximum = (purpose === "identity" ? 5 : 8) * 1024 * 1024;
  const format = mimeType === "image/jpeg" ? "jpeg" : mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : null;
  const signature = format === "jpeg" ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : format === "png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : format === "webp" && bytes.length >= 12 && bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  if (!format || !signature || !bytes.length || bytes.length > maximum) throw new Error("PRIVATE_PHOTO_INVALID");
  try {
    const image = sharp(bytes,{ limitInputPixels: 24_000_000, animated: false, failOn: "warning" });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1 || metadata.format !== format) throw new Error("Invalid decoded image");
    const normalized = await image.rotate().toFormat(format).toBuffer();
    if (normalized.length > maximum) throw new Error("Processed photo too large");
    return normalized;
  } catch { throw new Error("PRIVATE_PHOTO_INVALID"); }
}
