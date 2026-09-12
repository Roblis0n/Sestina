import { it, expect } from "vitest";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { verifyUpdate } from "../../apps/desktop/src/update-policy.js";
it("accepts a signed matching artifact and rejects real tamper, replay and target mismatch", () => {
  const keys = generateKeyPairSync("ed25519");
  const artifact = Buffer.from("Synthetic candidate bytes");
  const roots = { synthetic: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
  const current = { version: "0.2.0", platform: "win32", arch: "x64", schema: 25 };
  const identity = { ...current, version: "0.3.0", sourceCommit: "a".repeat(40), size: artifact.length, sha256: createHash("sha256").update(artifact).digest("hex") };
  const wrap = (item: unknown) => { const payload = JSON.stringify(item); return { payload, keyId: "synthetic", signature: sign(null, Buffer.from(payload), keys.privateKey).toString("base64") }; };
  expect(verifyUpdate(wrap(identity), roots, current, artifact).version).toBe("0.3.0");
  expect(() => verifyUpdate(wrap(identity), roots, current, Buffer.from("tampered"))).toThrow("artifact_mismatch");
  expect(() => verifyUpdate(wrap({ ...identity, version: "0.2.0" }), roots, current, artifact)).toThrow("replay_or_downgrade");
  expect(() => verifyUpdate(wrap({ ...identity, arch: "arm64" }), roots, current, artifact)).toThrow("target_mismatch");
  expect(() => verifyUpdate({ ...wrap(identity), payload: JSON.stringify({ ...identity, schema: 26 }) }, roots, current, artifact)).toThrow("signature_invalid");
  expect(() => verifyUpdate(wrap(identity), {}, current, artifact)).toThrow("signature_invalid");
});
