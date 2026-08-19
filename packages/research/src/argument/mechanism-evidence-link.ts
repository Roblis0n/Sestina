import { parseResearchSource, type ResearchSource } from "../authority/source.js";
import { cloneFrozen, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok, type ResearchResult } from "../result.js";
import type { EvidenceLinkStatus } from "./claim-evidence-link.js";

export interface MechanismEvidenceLink { readonly projectId: string; readonly mechanismLinkId: string; readonly evidenceId: string; readonly stepIndex: number; readonly status: EvidenceLinkStatus; readonly source: ResearchSource; readonly version: EntityVersion; }
export function parseMechanismEvidenceLink(input: unknown): ResearchResult<MechanismEvidenceLink> {
  if (!isRecord(input) || !Number.isSafeInteger(input.stepIndex) || Number(input.stepIndex) < 0 || !["proven", "unproven", "disputed", "stale"].includes(String(input.status))) return err(researchError("invalid_evidence_link"));
  const project = parseResearchIdFor(input.projectId, "rprj_"); const mechanism = parseResearchIdFor(input.mechanismLinkId, "rmec_"); const evidence = parseResearchIdFor(input.evidenceId, "revd_"); const source = parseResearchSource(input.source); const version = parseEntityVersion(input.version);
  if (!project.ok || !mechanism.ok || !evidence.ok || !source.ok || !version.ok) return err(researchError("invalid_evidence_link"));
  return ok(cloneFrozen({ projectId: project.value.id, mechanismLinkId: mechanism.value.id, evidenceId: evidence.value.id, stepIndex: Number(input.stepIndex), status: input.status as EvidenceLinkStatus, source: source.value, version: version.value }));
}
