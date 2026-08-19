import type { ResearchSource } from "../authority/source.js";
import { parseResearchSource } from "../authority/source.js";
import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { err, ok, type ResearchResult } from "../result.js";

export const CLAIM_KINDS = ["descriptive", "interpretive", "mechanistic", "causal", "comparative", "normative", "completion"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export interface ArgumentClaim {
  readonly id: string;
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly kind: ClaimKind;
  readonly statement: string;
  readonly source: ResearchSource;
  readonly version: EntityVersion;
}

export type Claim = ArgumentClaim;

export function parseArgumentClaim(input: unknown): ResearchResult<ArgumentClaim> {
  if (!isRecord(input) || !CLAIM_KINDS.includes(input.kind as ClaimKind) || !isNonBlankString(input.statement)) return err(researchError("invalid_claim"));
  const id = parseResearchIdFor(input.id, "rclm_"); const project = parseResearchIdFor(input.projectId, "rprj_"); const artifact = parseResearchIdFor(input.artifactId, "rart_"); const revision = parseResearchIdFor(input.revisionId, "rrev_"); const source = parseResearchSource(input.source); const version = parseEntityVersion(input.version);
  if (!id.ok || !project.ok || !artifact.ok || !revision.ok || !source.ok || !version.ok) return err(researchError("invalid_claim"));
  return ok(cloneFrozen({ id: id.value.id, projectId: project.value.id, artifactId: artifact.value.id, revisionId: revision.value.id, kind: input.kind as ClaimKind, statement: input.statement.trim(), source: source.value, version: version.value }));
}

export const parseClaim = parseArgumentClaim;
