import { createHash } from "node:crypto";
import { canonicalStringify, stableResearchHash, type ResearchIdPrefix } from "@sestina/research";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function hashCanonical(value: unknown): string {
  const result = stableResearchHash(value);
  if (!result.ok) throw new Error("Unable to hash legacy import metadata");
  return result.value;
}

export function canonical(value: unknown): string {
  const result = canonicalStringify(value);
  if (!result.ok) throw new Error("Unable to serialize legacy import metadata");
  return result.value;
}

export function deterministicResearchId(
  prefix: ResearchIdPrefix,
  sourceDatabaseFingerprint: string,
  legacyType: string,
  legacyId: string,
  role: string,
  mappingVersion: string,
): string {
  const digest = createHash("sha256")
    .update(canonical({ legacyId, legacyType, mappingVersion, role, sourceDatabaseFingerprint }))
    .digest("hex");
  let value = BigInt(`0x${digest}`) >> 126n;
  let suffix = "";
  for (let index = 0; index < 26; index += 1) {
    suffix = `${CROCKFORD[Number(value & 31n)] ?? "0"}${suffix}`;
    value >>= 5n;
  }
  return `${prefix}${suffix}`;
}

export function safeTimestamp(value: unknown): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return "1970-01-01T00:00:00.000Z";
}
