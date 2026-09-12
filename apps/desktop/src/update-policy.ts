import { verify, createHash } from "node:crypto";

export interface UpdateIdentity {
  version: string;
  platform: string;
  arch: string;
  schema: number;
  sourceCommit: string;
  sha256: string;
  size: number;
}
export interface UpdateEnvelope {
  payload: string;
  signature: string;
  keyId: string;
}
/** Trust comes from the installed application, never from downloaded metadata. */
export function verifyUpdate(
  envelope: UpdateEnvelope,
  roots: Readonly<Record<string, string>>,
  current: { version: string; platform: string; arch: string; schema: number },
  artifact: Uint8Array,
): UpdateIdentity {
  const key = roots[envelope.keyId];
  if (
    !key ||
    Buffer.byteLength(envelope.payload) > 16384 ||
    !verify(
      null,
      Buffer.from(envelope.payload),
      key,
      Buffer.from(envelope.signature, "base64"),
    )
  )
    throw new Error("update_signature_invalid");
  const value: unknown = JSON.parse(envelope.payload);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("update_identity_invalid");
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).sort().join(",") !==
      "arch,platform,schema,sha256,size,sourceCommit,version" ||
    typeof item.version !== "string" ||
    typeof item.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(item.sourceCommit) ||
    typeof item.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.sha256) ||
    !Number.isSafeInteger(item.schema) ||
    !Number.isSafeInteger(item.size)
  )
    throw new Error("update_identity_invalid");
  const version = (input: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(input);
    if (!match) throw new Error("update_version_invalid");
    return match.slice(1).map(Number);
  };
  const next = version(item.version),
    old = version(current.version);
  const differing = next.findIndex((part, index) => part !== old[index]);
  if (differing < 0 || Number(next[differing]) < Number(old[differing]))
    throw new Error("update_replay_or_downgrade");
  if (
    item.platform !== current.platform ||
    item.arch !== current.arch ||
    Number(item.schema) < current.schema
  )
    throw new Error("update_target_mismatch");
  if (
    artifact.byteLength !== item.size ||
    artifact.byteLength > 2147483648 ||
    createHash("sha256").update(artifact).digest("hex") !== item.sha256
  )
    throw new Error("update_artifact_mismatch");
  return item as unknown as UpdateIdentity;
}

// No authorized production signing root has been supplied for this internal
// candidate. This is an unavailable source, never "up to date" or unsigned trust.
export const TRUSTED_UPDATE_ROOTS: Readonly<Record<string, string>> =
  Object.freeze({});
