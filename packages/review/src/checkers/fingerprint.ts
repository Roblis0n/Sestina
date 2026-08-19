import { stableResearchHash } from "@sestina/research";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function reviewFingerprint(value: unknown): string {
  const result = stableResearchHash(value);
  return result.ok ? result.value : "0".repeat(64);
}

export function findingIdFromFingerprint(value: unknown): string {
  let bits = BigInt(`0x${reviewFingerprint(value)}`) >> 126n;
  let suffix = "";
  for (let index = 0; index < 26; index += 1) {
    suffix = `${CROCKFORD[Number(bits & 31n)] ?? "0"}${suffix}`;
    bits >>= 5n;
  }
  return `rfnd_${suffix}`;
}
