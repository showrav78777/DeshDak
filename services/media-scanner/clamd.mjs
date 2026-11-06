import { createConnection } from "node:net";

/** One framed command per bounded connection. Never send a client filename. */
export function clamdCommand({ host, port, signal }, command, bytes) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = Buffer.alloc(0); let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      signal?.removeEventListener("abort", abort); socket.destroy();
      if (error) reject(new Error("Scanner engine unavailable.")); else resolve(value);
    };
    const abort = () => finish(new Error("Aborted"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(9_000, abort);
    socket.on("error", abort);
    socket.on("close", () => { if (!settled) abort(); });
    socket.on("data", chunk => {
      if (response.length + chunk.length > 4096) { abort(); return; }
      response = Buffer.concat([response, chunk]);
      const end = response.indexOf(0);
      if (end !== -1) {
        if (end !== response.length - 1) { abort(); return; }
        finish(null, response.subarray(0, end).toString("utf8"));
      }
    });
    socket.on("connect", () => {
      socket.write(`z${command}\0`);
      if (command === "INSTREAM") {
        for (let offset = 0; offset < bytes.length; offset += 65_536) {
          const part = bytes.subarray(offset, offset + 65_536); const size = Buffer.alloc(4); size.writeUInt32BE(part.length);
          socket.write(size); socket.write(part);
        }
        socket.write(Buffer.alloc(4));
      }
    });
  });
}

export function requireFreshDefinitions(version, now = Date.now(), maximumAgeMs = 48 * 60 * 60_000) {
  const match = /^ClamAV [A-Za-z0-9.+-]+\/\d+\/([^\r\n\0]{8,100})$/.exec(version);
  const date = match ? Date.parse(`${match[1].replace(/\s+(?:GMT|UTC)$/i, "")} UTC`) : NaN;
  if (!Number.isFinite(date) || date > now + 5 * 60_000 || now - date > maximumAgeMs) throw new Error("Scanner definitions unavailable or stale.");
}
