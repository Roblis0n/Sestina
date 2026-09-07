import { writeSync } from "node:fs";
import { openResearchDeliberationKernel } from "@sestina/core";
const capability = Object.freeze({});
const kernel = await openResearchDeliberationKernel(process.argv[2]!, {
  resolveUser: (c) =>
    c === capability ? { kind: "user", actorId: "synthetic-owner" } : undefined,
  provider: async () => ({
    identity: {
      id: "synthetic",
      model: "fixture",
      family: "openai_compatible",
      locality: "local",
      origin: "http://127.0.0.1:1",
      configGeneration: 1,
      serializerVersion: "1.0.0",
    },
    maxOutputTokens: 1024,
    send: async () => {
      writeSync(
        1,
        JSON.stringify({
          reviewId: review.id,
          state: kernel.readReview(review.id, capability).review.status,
        }) + "\n",
      );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      return "{}";
    },
  }),
});
const review = kernel.createReview("Synthetic interruption", capability);
const p = await kernel.prepareManifest(
  review.id,
  review.version,
  {},
  true,
  capability,
);
let r = await kernel.confirmManifest(
  review.id,
  p.review.version,
  p.manifest.identityHash,
  capability,
);
r = kernel.prepareAttempt(review.id, r.version, capability);
await kernel.startAttempt(
  review.id,
  r.version,
  p.manifest.identityHash,
  capability,
);
