import { DEFAULT_RESPONSE_MAX_BYTES, utf8ByteLength } from "../limits.js";
import { redactAbsolutePaths } from "../redaction/redact.js";
import { reportErr, reportOk, type ReportResult } from "../result.js";
import { CAPSULE_RESPONSE_SCHEMA_VERSION, validateCapsuleResponseEnvelope } from "./response-schema.js";

export interface CapsuleResponseExpectation { readonly projectId: string; readonly capsuleHash: string; readonly snapshotHash: string; readonly reviewInputHash: string; readonly briefVersionId: string; readonly artifactRevisionId: string; }
export interface CapsuleCandidateResponse { readonly status: "candidate"; readonly authority: "model_proposed"; readonly canMutateAuthority: false; readonly projectId: string; readonly response: { readonly summary: string; readonly findings: readonly string[] }; }

export function importCapsuleResponse(json: string, expected: CapsuleResponseExpectation): ReportResult<CapsuleCandidateResponse> {
  if (utf8ByteLength(json) > DEFAULT_RESPONSE_MAX_BYTES) return reportErr("invalid_capsule_response");
  let raw: unknown; try { raw = JSON.parse(json); } catch { return reportErr("invalid_capsule_response"); }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && "schemaVersion" in raw && (raw as { schemaVersion?: unknown }).schemaVersion !== CAPSULE_RESPONSE_SCHEMA_VERSION) return reportErr("unsupported_capsule_response_version");
  const value = validateCapsuleResponseEnvelope(raw);
  if (value === undefined) return reportErr("invalid_capsule_response");
  if (value.projectId !== expected.projectId || value.capsuleHash !== expected.capsuleHash || value.snapshotHash !== expected.snapshotHash || value.reviewInputHash !== expected.reviewInputHash || value.briefVersionId !== expected.briefVersionId || value.artifactRevisionId !== expected.artifactRevisionId) return reportErr("stale_capsule_response");
  return reportOk({ status: "candidate", authority: "model_proposed", canMutateAuthority: false, projectId: value.projectId, response: { summary: redactAbsolutePaths(value.response.summary), findings: value.response.findings.map((item) => redactAbsolutePaths(item)) } });
}
