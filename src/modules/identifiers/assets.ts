import bwipjs from "bwip-js/node";
import QRCode from "qrcode";

import { barcodeValue, isPlatformCode, type PlatformEntity } from "./service.ts";

function canonicalOrigin(requestOrigin: string) {
  const configured = process.env.APP_BASE_URL?.trim();
  const value = configured || requestOrigin;
  const url = new URL(value);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) throw new Error("APP_BASE_URL must use HTTPS in production.");
  return url.origin;
}

export function scanPath(entity: PlatformEntity, platformCode: string) {
  if (!isPlatformCode(platformCode)) throw new Error("INVALID_PLATFORM_CODE");
  return `/scan/${entity === "PRODUCT" ? "products" : "orders"}/${encodeURIComponent(platformCode)}`;
}

export function scanUrl(entity: PlatformEntity, platformCode: string, requestOrigin: string) {
  return new URL(scanPath(entity, platformCode), canonicalOrigin(requestOrigin)).toString();
}

export async function renderQrSvg(entity: PlatformEntity, platformCode: string, requestOrigin: string) {
  return QRCode.toString(scanUrl(entity, platformCode, requestOrigin), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

export function renderBarcodeSvg(platformCode: string) {
  return bwipjs.toSVG({
    bcid: "code128",
    text: barcodeValue(platformCode),
    includetext: true,
    textxalign: "center",
    textsize: 12,
    height: 14,
    scale: 3,
    paddingwidth: 12,
    paddingheight: 8,
    backgroundcolor: "FFFFFF",
    barcolor: "000000",
    textcolor: "000000",
  });
}

export function svgResponse(svg: string, platformCode: string, kind: "qr" | "barcode", visibility: "public" | "private") {
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `inline; filename="${platformCode.toLowerCase()}-${kind}.svg"`,
      "Cache-Control": visibility === "public" ? "public, max-age=300, s-maxage=3600, immutable" : "private, no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
