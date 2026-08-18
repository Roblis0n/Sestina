/**
 * Entity versions are branded positive safe integers. The first version is
 * 1, every successful advance moves exactly +1 under compare-and-swap, and
 * a stale expectation fails with the stable `version_conflict` code.
 * Versions never come from the wall clock.
 */
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

declare const entityVersionBrand: unique symbol;
/** Branded entity version; only obtainable through the functions below. */
export type EntityVersion = number & { readonly [entityVersionBrand]: true };

export function initialEntityVersion(): EntityVersion {
  return 1 as EntityVersion;
}

export function parseEntityVersion(value: unknown): ResearchResult<EntityVersion> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return err(researchError("invalid_entity_version"));
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    return err(researchError("invalid_entity_version"));
  }
  return ok(value as EntityVersion);
}

export function advanceEntityVersion(
  current: EntityVersion,
  expected: EntityVersion,
): ResearchResult<EntityVersion> {
  const currentCheck = parseEntityVersion(current);
  if (!currentCheck.ok) return currentCheck;
  const expectedCheck = parseEntityVersion(expected);
  if (!expectedCheck.ok) return expectedCheck;

  if (expectedCheck.value !== currentCheck.value) {
    return err(
      researchError("version_conflict", {
        currentVersion: currentCheck.value,
        expectedVersion: expectedCheck.value,
      }),
    );
  }
  const next = currentCheck.value + 1;
  if (next > Number.MAX_SAFE_INTEGER) {
    return err(researchError("invalid_entity_version"));
  }
  return ok(next as EntityVersion);
}
