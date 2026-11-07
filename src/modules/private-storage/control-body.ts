import "server-only";

export async function readPrivateControlJson(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "") || !request.body) return null;
  const reader = request.body.getReader(); const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  let stop: (() => void) | undefined;
  try {
    if (signal.aborted) return null;
    const aborted = new Promise<never>((_, reject) => { stop = () => reject(new Error("Aborted")); signal.addEventListener("abort", stop, { once: true }); });
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) { const part = await Promise.race([reader.read(), aborted]); if (part.done) break; size += part.value.byteLength; if (size > 4096) return null; chunks.push(part.value); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
  finally { if (stop) signal.removeEventListener("abort", stop); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
