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
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-g10\.[a-f0-9]{8})?$/.exec(input);
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

export interface InstalledUpdateIdentity {
  version: string;
  channel: "internal_candidate" | "stable";
  sequence: number;
  platform: string;
  arch: string;
  schema: number;
  sourceCommit: string;
  migrationSourceSha256: string;
}
export interface UpdateOffer extends InstalledUpdateIdentity {
  format: "2.0.0";
  sha256: string;
  size: number;
  unsignedCoreSha256: string;
  artifactPath: string;
  signed: boolean;
}
/** The running updater accepts only the complete, signed desktop contract. */
export function verifyUpdateOffer(
  envelope: unknown,
  roots: Readonly<Record<string, string>>,
  current: InstalledUpdateIdentity,
): UpdateOffer {
  const bad = (code: string): never => {
    throw Error(code);
  };
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    bad("update_signature_invalid");
  const signed = envelope as Record<string, unknown>;
  if (
    Object.keys(signed).sort().join(",") !== "keyId,payload,signature" ||
    typeof signed.keyId !== "string" ||
    typeof signed.payload !== "string" ||
    typeof signed.signature !== "string" ||
    signed.payload.length > 16384 ||
    signed.signature.length > 128
  )
    bad("update_signature_invalid");
  const key = roots[signed.keyId as string];
  if (
    !key ||
    !verify(
      null,
      Buffer.from(signed.payload as string),
      key,
      Buffer.from(signed.signature as string, "base64"),
    )
  )
    bad("update_signature_invalid");
  const value: unknown = JSON.parse(signed.payload as string);
  if (!value || typeof value !== "object" || Array.isArray(value))
    bad("update_identity_invalid");
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).sort().join(",") !==
      "arch,artifactPath,channel,format,migrationSourceSha256,platform,schema,sequence,sha256,signed,size,sourceCommit,unsignedCoreSha256,version" ||
    item.format !== "2.0.0"
  )
    bad("update_identity_invalid");
  for (const name of ["sha256", "migrationSourceSha256", "unsignedCoreSha256"])
    if (typeof item[name] !== "string" || !/^[a-f0-9]{64}$/.test(item[name]))
      bad("update_identity_invalid");
  if (
    typeof item.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(item.sourceCommit) ||
    typeof item.version !== "string" ||
    typeof item.signed !== "boolean" ||
    !Number.isSafeInteger(item.sequence) ||
    !Number.isSafeInteger(item.schema) ||
    !Number.isSafeInteger(item.size) ||
    Number(item.size) < 1 ||
    Number(item.size) > 2147483648
  )
    bad("update_identity_invalid");
  if (
    item.channel !== current.channel ||
    item.platform !== current.platform ||
    item.arch !== current.arch ||
    item.schema !== current.schema ||
    item.migrationSourceSha256 !== current.migrationSourceSha256
  )
    bad("update_target_mismatch");
  if (item.channel === "stable") {
    if (!/^\d+\.\d+\.\d+$/.test(item.version as string) || item.signed !== true)
      bad("update_identity_invalid");
    const next = (item.version as string).split(".").map(Number),
      old = current.version.split(".").map(Number);
    const diff = next.findIndex((n, i) => n !== old[i]);
    if (diff < 0 || Number(next[diff]) < Number(old[diff]))
      bad("update_replay_or_downgrade");
  } else if (
    !/^\d+\.\d+\.\d+-g10\.[a-f0-9]{8}$/.test(item.version as string) ||
    (item.version as string).split("-g10.")[1] !==
      (item.sourceCommit as string).slice(0, 8)
  )
    bad("update_identity_invalid");
  const nextBase = ((item.version as string).split("-")[0] ?? "")
      .split(".")
      .map(Number),
    oldBase = (current.version.split("-")[0] ?? "").split(".").map(Number);
  const baseDiff = nextBase.findIndex((n, i) => n !== oldBase[i]);
  if (
    nextBase.some((n) => !Number.isSafeInteger(n)) ||
    (baseDiff >= 0 && Number(nextBase[baseDiff]) < Number(oldBase[baseDiff]))
  )
    bad("update_replay_or_downgrade");
  if (
    Number(item.sequence) <= current.sequence ||
    item.sourceCommit === current.sourceCommit
  )
    bad("update_replay_or_downgrade");
  const extension =
    current.platform === "win32"
      ? "exe"
      : current.platform === "darwin"
        ? "dmg"
        : "AppImage";
  if (
    item.artifactPath !==
    `/artifacts/${String(item.sha256)}/Sestina.${extension}`
  )
    bad("update_identity_invalid");
  return item as unknown as UpdateOffer;
}
