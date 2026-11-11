import { createHash, createHmac } from "node:crypto";

export interface UploadChunk {
  sessionId: string;
  chunkIndex: number;
  totalChunks: number;
  offsetBytes: number;
  payload: Uint8Array;
  sha256: string;
  hmac: string;
}

export interface UploadTransport {
  sendChunk(chunk: UploadChunk): Promise<{ accepted: boolean; reason?: string }>;
  getCommittedChunks(sessionId: string): Promise<number[]>;
}

export interface UploadReceipt {
  sessionId: string;
  totalBytes: number;
  totalChunks: number;
  transmittedChunks: number;
  skippedCommittedChunks: number;
  manifestSha256: string;
}

export function computeHmac(secret: string, sessionId: string, chunkIndex: number, sha256Hex: string): string {
  return createHmac("sha256", secret)
    .update(`${sessionId}:${chunkIndex}:${sha256Hex}`)
    .digest("hex");
}

export class InMemoryChunkTransport implements UploadTransport {
  private readonly store = new Map<string, Map<number, Uint8Array>>();
  private readonly secret: string;
  public failedAttemptsLeft = 0;

  constructor(secret: string) {
    this.secret = secret;
  }

  async sendChunk(chunk: UploadChunk): Promise<{ accepted: boolean; reason?: string }> {
    if (this.failedAttemptsLeft > 0) {
      this.failedAttemptsLeft -= 1;
      throw new Error("Simulated transient edge uplink timeout");
    }
    const digest = createHash("sha256").update(chunk.payload).digest("hex");
    if (digest !== chunk.sha256) {
      return { accepted: false, reason: "sha256_mismatch" };
    }
    const expectedHmac = computeHmac(this.secret, chunk.sessionId, chunk.chunkIndex, digest);
    if (expectedHmac !== chunk.hmac) {
      return { accepted: false, reason: "hmac_verification_failed" };
    }
    if (!this.store.has(chunk.sessionId)) {
      this.store.set(chunk.sessionId, new Map());
    }
    this.store.get(chunk.sessionId)!.set(chunk.chunkIndex, chunk.payload);
    return { accepted: true };
  }

  async getCommittedChunks(sessionId: string): Promise<number[]> {
    const chunks = this.store.get(sessionId);
    if (!chunks) return [];
    return [...chunks.keys()].sort((a, b) => a - b);
  }

  reassemble(sessionId: string): Uint8Array {
    const chunks = this.store.get(sessionId);
    if (!chunks) return new Uint8Array(0);
    const ordered = [...chunks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    return Buffer.concat(ordered);
  }
}

export class ResumableChunkUploader {
  private readonly chunkSizeBytes: number;
  private readonly secret: string;
  private readonly maxRetries: number;

  constructor(opts: { chunkSizeBytes?: number; hmacSecret: string; maxRetries?: number }) {
    this.chunkSizeBytes = opts.chunkSizeBytes ?? 64 * 1024;
    this.secret = opts.hmacSecret;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async upload(sessionId: string, data: Uint8Array, transport: UploadTransport): Promise<UploadReceipt> {
    const totalChunks = Math.max(1, Math.ceil(data.byteLength / this.chunkSizeBytes));
    const committed = new Set(await transport.getCommittedChunks(sessionId));
    let transmittedChunks = 0;
    let skippedCommittedChunks = 0;
    const chunkHashes: string[] = [];

    for (let idx = 0; idx < totalChunks; idx += 1) {
      const start = idx * this.chunkSizeBytes;
      const end = Math.min(data.byteLength, start + this.chunkSizeBytes);
      const slice = data.subarray(start, end);
      const sha256 = createHash("sha256").update(slice).digest("hex");
      chunkHashes.push(sha256);

      if (committed.has(idx)) {
        skippedCommittedChunks += 1;
        continue;
      }

      const chunk: UploadChunk = {
        sessionId,
        chunkIndex: idx,
        totalChunks,
        offsetBytes: start,
        payload: slice,
        sha256,
        hmac: computeHmac(this.secret, sessionId, idx, sha256),
      };

      let sent = false;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        try {
          const res = await transport.sendChunk(chunk);
          if (!res.accepted) {
            throw new Error(`Chunk ${idx} rejected: ${res.reason ?? "unknown"}`);
          }
          sent = true;
          transmittedChunks += 1;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!sent) {
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      }
    }

    const manifestSha256 = createHash("sha256")
      .update(chunkHashes.join(":"))
      .digest("hex");

    return {
      sessionId,
      totalBytes: data.byteLength,
      totalChunks,
      transmittedChunks,
      skippedCommittedChunks,
      manifestSha256,
    };
  }
}
