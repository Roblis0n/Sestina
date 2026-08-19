import { parseResearchSource, type ResearchSource } from "../authority/source.js";
import { cloneFrozen, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok, type ResearchResult } from "../result.js";

export type EvidenceLinkStatus = "proven" | "unproven" | "disputed" | "stale";
export type ClaimEvidenceRole = "supports" | "contradicts" | "qualifies" | "background_only";
export interface ClaimEvidenceLink { readonly projectId: string; readonly claimId: string; readonly evidenceId: string; readonly role: ClaimEvidenceRole; readonly status: EvidenceLinkStatus; readonly source: ResearchSource; readonly version: EntityVersion; }
export function parseClaimEvidenceLink(input: unknown): ResearchResult<ClaimEvidenceLink> {
  if (!isRecord(input) || !["supports", "contradicts", "qualifies", "background_only"].includes(String(input.role)) || !["proven", "unproven", "disputed", "stale"].includes(String(input.status))) return err(researchError("invalid_evidence_link"));
  const project = parseResearchIdFor(input.projectId, "rprj_"); const claim = parseResearchIdFor(input.claimId, "rclm_"); const evidence = parseResearchIdFor(input.evidenceId, "revd_"); const source = parseResearchSource(input.source); const version = parseEntityVersion(input.version);
  if (!project.ok || !claim.ok || !evidence.ok || !source.ok || !version.ok) return err(researchError("invalid_evidence_link"));
  return ok(cloneFrozen({ projectId: project.value.id, claimId: claim.value.id, evidenceId: evidence.value.id, role: input.role as ClaimEvidenceRole, status: input.status as EvidenceLinkStatus, source: source.value, version: version.value }));
}
