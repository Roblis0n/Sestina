import { parseResearchIdFor } from "@sestina/research";
import { DEFAULT_RESPONSE_MAX_BYTES, truncateUtf8, utf8ByteLength } from "../limits.js";
import { redactAbsolutePaths } from "../redaction/redact.js";
import { reportErr, reportOk, type ReportResult } from "../result.js";

export interface CapsuleResponseExpectation { readonly projectId: string; readonly snapshotHash: string; readonly reviewInputHash: string; readonly briefVersionId: string; readonly artifactRevisionId: string; }
export interface CapsuleCandidateResponse { readonly status: "candidate"; readonly authority: "model_proposed"; readonly canMutateAuthority: false; readonly projectId: string; readonly response: { readonly summary: string; readonly findings: readonly string[] }; }

export function importCapsuleResponse(json: string, expected: CapsuleResponseExpectation): ReportResult<CapsuleCandidateResponse> {
  if (utf8ByteLength(json) > DEFAULT_RESPONSE_MAX_BYTES) return reportErr("invalid_capsule_response");
  let raw: unknown; try { raw = JSON.parse(json); } catch { return reportErr("invalid_capsule_response"); }
  if (typeof raw !== "object" || raw === null) return reportErr("invalid_capsule_response"); const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== "1.0.0") return reportErr("unsupported_capsule_response_version");
  if (typeof value.projectId !== "string" || typeof value.snapshotHash !== "string" || typeof value.reviewInputHash !== "string" || typeof value.briefVersionId !== "string" || typeof value.artifactRevisionId !== "string" || typeof value.response !== "object" || value.response === null) return reportErr("invalid_capsule_response");
  const project = parseResearchIdFor(value.projectId, "rprj_"); const brief = parseResearchIdFor(value.briefVersionId, "rbrf_"); const revision = parseResearchIdFor(value.artifactRevisionId, "rrev_");
  if (!project.ok || !brief.ok || !revision.ok || !/^[0-9a-f]{64}$/.test(value.snapshotHash) || !/^[0-9a-f]{64}$/.test(value.reviewInputHash)) return reportErr("invalid_capsule_response");
  if (value.projectId !== expected.projectId || value.snapshotHash !== expected.snapshotHash || value.reviewInputHash !== expected.reviewInputHash || value.briefVersionId !== expected.briefVersionId || value.artifactRevisionId !== expected.artifactRevisionId) return reportErr("stale_capsule_response");
  const response = value.response as Record<string, unknown>;
  if (typeof response.summary !== "string" || !Array.isArray(response.findings) || response.findings.some((item) => typeof item !== "string")) return reportErr("invalid_capsule_response");
  return reportOk({ status: "candidate", authority: "model_proposed", canMutateAuthority: false, projectId: project.value.id, response: { summary: truncateUtf8(redactAbsolutePaths(response.summary), 2_048).text, findings: response.findings.slice(0, 100).map((item) => truncateUtf8(redactAbsolutePaths(String(item)), 2_048).text) } });
}
