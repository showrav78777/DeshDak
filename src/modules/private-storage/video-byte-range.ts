/** Single-range policy based on RFC 9110 sections 13.1.5 and 14.
 * Unknown units, multipart ranges and unmatchable If-Range fall back to full GET.
 * Large numerals are compared as BigInt before conversion to bounded offsets. */
export function privateVideoByteRange(total: number, range?: string | null, ifRange?: string | null, method: "GET" | "HEAD" = "GET") {
  if (!Number.isSafeInteger(total) || total < 1 || total > 8 * 1024 * 1024) throw new Error("PRIVATE_VIDEO_RANGE_INVALID");
  const full = { start: 0, end: total - 1, partial: false };
  if (method !== "GET" || !range || ifRange != null) return full;
  if (!/^bytes=/i.test(range.trim())) return full;
  if (range.length > 160) throw new Error("PRIVATE_VIDEO_RANGE_INVALID");
  if (range.includes(",")) return full;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || !match[1] && !match[2]) throw new Error("PRIVATE_VIDEO_RANGE_INVALID");
  const size = BigInt(total);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (!suffix) throw new Error("PRIVATE_VIDEO_RANGE_INVALID");
    return { start: suffix >= size ? 0 : total - Number(suffix), end: total - 1, partial: true };
  }
  const start = BigInt(match[1]), end = match[2] ? BigInt(match[2]) : size - BigInt(1);
  if (start >= size || end < start) throw new Error("PRIVATE_VIDEO_RANGE_INVALID");
  return { start: Number(start), end: Number(end >= size ? size - BigInt(1) : end), partial: true };
}
