import "server-only";

export class MultipartUploadError extends Error {
  readonly status: 408 | 413 | 415 | 422;
  constructor(status: 408 | 413 | 415 | 422, message: string) { super(message); this.status = status; }
}

/** Count actual streamed bytes before invoking the multipart parser. */
export async function readBoundedMultipart(request: Request, maximum: number, timeoutMs = 15_000): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType) || request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity") throw new MultipartUploadError(415, "Use an uncompressed multipart upload.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum)) throw new MultipartUploadError(413, "Upload exceeds the permitted request size.");
  const reader = request.body?.getReader();
  if (!reader) throw new MultipartUploadError(422, "Upload body is missing.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new MultipartUploadError(408, "Upload timed out. Please try again.")), timeoutMs); });
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) throw new MultipartUploadError(413, "Upload exceeds the permitted request size.");
      chunks.push(part.value);
    }
    if (declared !== null && Number(declared) !== size) throw new MultipartUploadError(422, "Upload body length is invalid.");
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
  } catch (error) {
    if (error instanceof MultipartUploadError) throw error;
    throw new MultipartUploadError(422, "Upload form could not be read.");
  } finally {
    clearTimeout(timer);
    // Release/cancel even when an oversized or stalled stream was rejected.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
