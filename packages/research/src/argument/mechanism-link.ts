import type { ResearchSource } from "../authority/source.js";
import { parseResearchSource } from "../authority/source.js";
import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok, type ResearchResult } from "../result.js";

export interface MechanismLink {
  readonly id: string;
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly fromClaimId: string;
  readonly toClaimId: string;
  readonly relation: string;
  readonly intermediateSteps: readonly string[];
  readonly source: ResearchSource;
}

export function parseMechanismLink(input: unknown): ResearchResult<MechanismLink> {
  if (!isRecord(input) || !isNonBlankString(input.relation) || !Array.isArray(input.intermediateSteps) || input.intermediateSteps.length === 0) return err(researchError("invalid_mechanism_link"));
  const id = parseResearchIdFor(input.id, "rmec_"); const project = parseResearchIdFor(input.projectId, "rprj_"); const artifact = parseResearchIdFor(input.artifactId, "rart_"); const revision = parseResearchIdFor(input.revisionId, "rrev_"); const from = parseResearchIdFor(input.fromClaimId, "rclm_"); const to = parseResearchIdFor(input.toClaimId, "rclm_"); const source = parseResearchSource(input.source);
  const steps: string[] = [];
  for (const raw of input.intermediateSteps) { if (!isNonBlankString(raw) || steps.includes(raw.trim())) return err(researchError("invalid_mechanism_link")); steps.push(raw.trim()); }
  if (!id.ok || !project.ok || !artifact.ok || !revision.ok || !from.ok || !to.ok || from.value.id === to.value.id || !source.ok) return err(researchError("invalid_mechanism_link"));
  return ok(cloneFrozen({ id: id.value.id, projectId: project.value.id, artifactId: artifact.value.id, revisionId: revision.value.id, fromClaimId: from.value.id, toClaimId: to.value.id, relation: input.relation.trim(), intermediateSteps: steps, source: source.value }));
}
