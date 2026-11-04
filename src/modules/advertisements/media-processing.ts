import sharp from "sharp";

export type WebsiteImageCrop = { x:number; y:number; width:number; height:number };
export async function processWebsiteImage(file: File, crop?: WebsiteImageCrop) {
  if (crop && (![crop.x,crop.y,crop.width,crop.height].every(Number.isFinite) || crop.x<0 || crop.y<0 || crop.width<1 || crop.height<1 || crop.x+crop.width>100 || crop.y+crop.height>100)) throw new Error("Crop must fit inside the image.");
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("Choose an image under 8 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const signature = file.type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : file.type === "image/webp" && bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  if (!signature) throw new Error("Choose a valid PNG, JPEG or WebP image. SVG and other files are not supported.");
  const image = sharp(bytes, { limitInputPixels: 24_000_000, animated: false });
  const metadata = await image.metadata();
  if ((metadata.pages ?? 1) > 1) throw new Error("Animated images are not supported.");
  const oriented = await image.rotate().toBuffer({resolveWithObject:true});
  const region = crop ? { left:Math.floor(oriented.info.width*crop.x/100), top:Math.floor(oriented.info.height*crop.y/100), width:Math.max(1,Math.floor(oriented.info.width*crop.width/100)), height:Math.max(1,Math.floor(oriented.info.height*crop.height/100)) } : null;
  let output = sharp(oriented.data,{limitInputPixels:24_000_000});
  if (region) output=output.extract(region);
  const result = await output.resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
  if (result.data.length > 3 * 1024 * 1024) throw new Error("Image is too complex. Choose a smaller image.");
  return { bytes: result.data, width: result.info.width, height: result.info.height, sizeBytes: result.data.length };
}
