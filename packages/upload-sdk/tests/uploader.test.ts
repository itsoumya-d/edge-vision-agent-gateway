import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryChunkTransport, ResumableChunkUploader } from "../src/chunkedUploader.ts";

test("ResumableChunkUploader splits, retries transient failures, and resumes skipping committed chunks", async () => {
  const payload = Buffer.from("A".repeat(1200) + "B".repeat(900) + "C".repeat(400));
  const transport = new InMemoryChunkTransport("super-secret-edge-key");
  const uploader = new ResumableChunkUploader({
    chunkSizeBytes: 512,
    hmacSecret: "super-secret-edge-key",
    maxRetries: 2,
  });

  // Fail once mid-flight before succeeding on retry
  transport.failedAttemptsLeft = 1;
  const first = await uploader.upload("sess-cam-01", payload, transport);
  assert.equal(first.totalChunks, 5);
  assert.equal(first.transmittedChunks, 5);
  assert.equal(first.skippedCommittedChunks, 0);
  assert.deepEqual(Buffer.from(transport.reassemble("sess-cam-01")), payload);

  // Resume session: zero duplicate chunk uploads
  const resumed = await uploader.upload("sess-cam-01", payload, transport);
  assert.equal(resumed.skippedCommittedChunks, 5);
  assert.equal(resumed.transmittedChunks, 0);
  assert.equal(resumed.manifestSha256, first.manifestSha256);
});

test("Transport rejects tampered HMAC signature", async () => {
  const transport = new InMemoryChunkTransport("key-1");
  const badUploader = new ResumableChunkUploader({
    chunkSizeBytes: 256,
    hmacSecret: "wrong-key",
    maxRetries: 0,
  });
  await assert.rejects(
    () => badUploader.upload("sess-bad", Buffer.from("frame-bytes"), transport),
    /hmac_verification_failed/
  );
});
