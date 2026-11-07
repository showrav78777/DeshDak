import "server-only";
import { createHash } from "node:crypto";

export type PrivatePhotoScanProof = { sha256: string; verifiedAt: Date };
export function createPrivatePhotoScanner(config: { url: string; token: string }, transport: typeof fetch = fetch) {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new Error("PRIVATE_PHOTO_SCANNER_UNAVAILABLE"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || config.token.length < 32 || config.token.length > 256 || /\s/.test(config.token)) throw new Error("PRIVATE_PHOTO_SCANNER_UNAVAILABLE");
  return async (input: Buffer): Promise<PrivatePhotoScanProof> => {
    const bytes = Buffer.from(input);
    if (!bytes.length || bytes.length > 8*1024*1024) throw new Error("PRIVATE_PHOTO_SCAN_FAILED");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),15_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let removeAbort: (() => void) | undefined;
    try {
      const response = await transport(url,{ method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/octet-stream", "Accept": "application/json", "Accept-Encoding": "identity", "X-Deshdak-Scan-Sha256": digest }, body: new Uint8Array(bytes), signal: controller.signal, redirect: "error", cache: "no-store" });
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") || ![null,"identity"].includes(response.headers.get("content-encoding")) || !response.body) throw new Error("Scanner unavailable");
      reader = response.body.getReader();
      if (controller.signal.aborted) throw new Error("Aborted");
      const aborted = new Promise<never>((_,reject) => {
        const cancel = () => reject(new Error("Aborted"));
        controller.signal.addEventListener("abort",cancel,{once:true}); removeAbort = () => controller.signal.removeEventListener("abort",cancel);
      });
      const chunks: Buffer[] = []; let size = 0;
      for (;;) {
        const part = await Promise.race([reader.read(),aborted]); if (part.done) break;
        size += part.value.byteLength; if (size > 2048) throw new Error("Scanner response too large");
        chunks.push(Buffer.from(part.value));
      }
      const result = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
      if (!result || result.status !== "clean" || result.sha256 !== digest || Object.keys(result).some(key => !["status","sha256"].includes(key))) throw new Error("Unconfirmed scan");
      return { sha256: digest, verifiedAt: new Date() };
    } catch { throw new Error("PRIVATE_PHOTO_SCAN_FAILED"); }
    finally { clearTimeout(timeout); removeAbort?.(); void reader?.cancel().catch(()=>{}); reader?.releaseLock(); }
  };
}
