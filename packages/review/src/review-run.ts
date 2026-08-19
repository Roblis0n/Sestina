import { parseEntityVersion, parseResearchIdFor, type Clock, type EntityVersion, type IdFactory } from "@sestina/research";
import type { CheckerResult, ResearchChecker } from "./checker.js";
import { createFinding, type Finding } from "./finding.js";
import { CheckerRegistry } from "./registry.js";
import { parseReviewContext, type CheckerIdentity, type ReviewContext } from "./review-context.js";
import { cloneReviewValue, reviewErr, reviewError, reviewOk, type ReviewResult } from "./review-result.js";

export type ReviewRunStatus = "running" | "completed_no_findings" | "completed_with_findings" | "completed_with_checker_errors";
export interface CheckerErrorRecord { readonly checker: CheckerIdentity; readonly code: "checker_error"; }
export interface ReviewRun {
  readonly id: string; readonly projectId: string; readonly episodeId: string; readonly snapshotId: string;
  readonly context: ReviewContext; readonly inputHash: string; readonly status: ReviewRunStatus;
  readonly findings: readonly Finding[]; readonly checkerErrors: readonly CheckerErrorRecord[];
  readonly version: EntityVersion; readonly startedAt: string; readonly completedAt?: string;
}

function at(clock: Clock): ReviewResult<string> { try { const value = clock.now(); return value instanceof Date && Number.isFinite(value.getTime()) ? reviewOk(value.toISOString()) : reviewErr(reviewError("invalid_review_run")); } catch { return reviewErr(reviewError("invalid_review_run")); } }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

export function parseReviewRun(input: unknown): ReviewResult<ReviewRun> {
  if (!record(input) || !Array.isArray(input.findings) || !Array.isArray(input.checkerErrors) || !["running", "completed_no_findings", "completed_with_findings", "completed_with_checker_errors"].includes(String(input.status)) || typeof input.startedAt !== "string" || !Number.isFinite(Date.parse(input.startedAt))) return reviewErr(reviewError("invalid_review_run"));
  const id = parseResearchIdFor(input.id, "rrun_"); const projectId = parseResearchIdFor(input.projectId, "rprj_"); const episodeId = parseResearchIdFor(input.episodeId, "repi_"); const snapshotId = parseResearchIdFor(input.snapshotId, "rsnp_"); const version = parseEntityVersion(input.version); const context = parseReviewContext(input.context);
  if (!id.ok || !projectId.ok || !episodeId.ok || !snapshotId.ok || !version.ok || !context.ok || input.inputHash !== context.value.inputHash || context.value.project.id !== projectId.value.id || context.value.episode.id !== episodeId.value.id || context.value.snapshot.id !== snapshotId.value.id) return reviewErr(reviewError("invalid_review_run"));
  const findings: Finding[] = [];
  for (const raw of input.findings) { const parsed = createFinding(raw); if (!parsed.ok || findings.some((item) => item.id === parsed.value.id)) return reviewErr(reviewError("invalid_review_run")); findings.push(parsed.value); }
  const checkerErrors: CheckerErrorRecord[] = [];
  for (const raw of input.checkerErrors) { if (!record(raw) || raw.code !== "checker_error" || !record(raw.checker) || typeof raw.checker.id !== "string" || typeof raw.checker.version !== "string" || (raw.checker.kind !== "deterministic" && raw.checker.kind !== "semantic")) return reviewErr(reviewError("invalid_review_run")); checkerErrors.push({ checker: { id: raw.checker.id, version: raw.checker.version, kind: raw.checker.kind }, code: "checker_error" }); }
  const terminal = input.status !== "running";
  if (terminal !== (typeof input.completedAt === "string") || (typeof input.completedAt === "string" && (!Number.isFinite(Date.parse(input.completedAt)) || input.completedAt < input.startedAt))) return reviewErr(reviewError("invalid_review_run"));
  if ((input.status === "completed_no_findings" && findings.length !== 0) || (input.status === "completed_with_findings" && (findings.length === 0 || checkerErrors.length > 0)) || (input.status === "completed_with_checker_errors" && checkerErrors.length === 0)) return reviewErr(reviewError("invalid_review_run"));
  return reviewOk(cloneReviewValue({ id: id.value.id, projectId: projectId.value.id, episodeId: episodeId.value.id, snapshotId: snapshotId.value.id, context: context.value, inputHash: context.value.inputHash, status: input.status as ReviewRunStatus, findings, checkerErrors, version: version.value, startedAt: input.startedAt, ...(typeof input.completedAt === "string" ? { completedAt: input.completedAt } : {}) }));
}

export function createReviewRun(contextInput: ReviewContext, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ReviewResult<ReviewRun> {
  const context = parseReviewContext(contextInput); if (!context.ok) return context;
  const id = parseResearchIdFor(ports.idFactory.create("rrun_"), "rrun_"); const started = at(ports.clock); if (!id.ok || !started.ok) return reviewErr(reviewError("invalid_review_run"));
  return parseReviewRun({ id: id.value.id, projectId: context.value.project.id, episodeId: context.value.episode.id, snapshotId: context.value.snapshot.id, context: context.value, inputHash: context.value.inputHash, status: "running", findings: [], checkerErrors: [], version: 1, startedAt: started.value });
}

export function appendReviewFindings(currentInput: ReviewRun, findingsInput: readonly Finding[], checkerErrorsInput: readonly CheckerErrorRecord[], expectedVersion: EntityVersion): ReviewResult<ReviewRun> {
  const current = parseReviewRun(currentInput); const expected = parseEntityVersion(expectedVersion); if (!current.ok || !expected.ok || current.value.status !== "running" || current.value.version !== expected.value) return reviewErr(reviewError("review_version_conflict"));
  const findings: Finding[] = [];
  for (const raw of findingsInput) { const parsed = createFinding(raw); if (!parsed.ok || parsed.value.provenance.inputHash !== current.value.inputHash || current.value.findings.some((item) => item.id === parsed.value.id) || findings.some((item) => item.id === parsed.value.id)) return reviewErr(reviewError("invalid_finding")); findings.push(parsed.value); }
  return parseReviewRun({ ...current.value, findings: [...current.value.findings, ...findings], checkerErrors: [...current.value.checkerErrors, ...checkerErrorsInput], version: current.value.version + 1 });
}

export function finalizeReviewRun(currentInput: ReviewRun, expectedVersion: EntityVersion, clock: Clock): ReviewResult<ReviewRun> {
  const current = parseReviewRun(currentInput); const expected = parseEntityVersion(expectedVersion); if (!current.ok || !expected.ok || current.value.status !== "running" || current.value.version !== expected.value) return reviewErr(reviewError("review_version_conflict"));
  const completed = at(clock); if (!completed.ok) return completed;
  const status: ReviewRunStatus = current.value.checkerErrors.length > 0 ? "completed_with_checker_errors" : current.value.findings.length > 0 ? "completed_with_findings" : "completed_no_findings";
  return parseReviewRun({ ...current.value, status, version: current.value.version + 1, completedAt: completed.value });
}

function checkerErrorFinding(checker: CheckerIdentity, context: ReviewContext, idFactory: IdFactory): Finding {
  const created = createFinding({ id: idFactory.create("rfnd_"), kind: "checker_error", severity: "error", target: { kind: "project" }, baselineEvidence: [], candidateEvidence: [], briefVersionId: context.briefVersion.id, decisionIds: [], issueIds: [], checker, confidence: { source: checker.kind === "semantic" ? "model" : "rule", value: 0 }, rationale: `Checker ${checker.id} did not produce a valid result`, minimumRecovery: `Re-run checker ${checker.id} version ${checker.version}`, needsUserDecision: false, presentation: "audit_only", provenance: { authority: checker.kind === "semantic" ? "model_proposed" : "system_derived", inputHash: context.inputHash } });
  if (!created.ok) throw new Error("checker_error finding construction failed");
  return created.value;
}

async function execute(checker: ResearchChecker, context: ReviewContext): Promise<CheckerResult | undefined> {
  try { if (!checker.supports(context)) return undefined; return await checker.run(context); } catch { return undefined; }
}

export async function runReview(contextInput: ReviewContext, registry: CheckerRegistry, ports: { readonly clock: Clock; readonly idFactory: IdFactory; readonly mode: "sequential" | "parallel" }): Promise<ReviewResult<ReviewRun>> {
  const context = parseReviewContext(contextInput); if (!context.ok) return context;
  const started = createReviewRun(context.value, ports); if (!started.ok) return started;
  const bound = context.value.checkerSet.map((identity) => ({ identity, checker: registry.get(identity.id, identity.version) }));
  const executions: { identity: CheckerIdentity; result: CheckerResult | undefined }[] = [];
  if (ports.mode === "parallel") {
    const values = await Promise.all(bound.map(async ({ identity, checker }) => ({ identity, result: checker?.kind === identity.kind ? await execute(checker, context.value) : undefined })));
    executions.push(...values);
  } else {
    for (const { identity, checker } of bound) executions.push({ identity, result: checker?.kind === identity.kind ? await execute(checker, context.value) : undefined });
  }
  executions.sort((a, b) => a.identity.id.localeCompare(b.identity.id) || a.identity.version.localeCompare(b.identity.version));
  const findings: Finding[] = []; const errors: CheckerErrorRecord[] = [];
  for (const execution of executions) {
    let valid = execution.result !== undefined && Array.isArray(execution.result.findings);
    const parsed: Finding[] = [];
    if (valid && execution.result) {
      for (const raw of execution.result.findings) {
        const finding = createFinding(raw);
        if (!finding.ok || finding.value.checker.id !== execution.identity.id || finding.value.checker.version !== execution.identity.version || finding.value.checker.kind !== execution.identity.kind || finding.value.provenance.inputHash !== context.value.inputHash) { valid = false; break; }
        parsed.push(finding.value);
      }
    }
    if (!valid) { findings.push(checkerErrorFinding(execution.identity, context.value, ports.idFactory)); errors.push({ checker: execution.identity, code: "checker_error" }); }
    else findings.push(...parsed);
  }
  findings.sort((a, b) => a.checker.id.localeCompare(b.checker.id) || a.checker.version.localeCompare(b.checker.version) || a.id.localeCompare(b.id));
  const appended = appendReviewFindings(started.value, findings, errors, started.value.version); if (!appended.ok) return appended;
  return finalizeReviewRun(appended.value, appended.value.version, ports.clock);
}
