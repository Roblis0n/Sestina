import { canonicalStringify, parseEntityVersion, parseResearchIdFor, type EntityVersion } from "@sestina/research";
import {
  appendReviewFindings,
  parseFinding,
  parseReviewRun,
  reviewErr,
  reviewError,
  type CheckerErrorRecord,
  type Finding,
  type ReviewResult,
  type ReviewRun,
  type ReviewRunRepository,
} from "@sestina/review";
import { withTransaction, type StorageDatabase } from "@sestina/storage";

function encode(value: unknown): ReviewResult<string> {
  const result = canonicalStringify(value);
  return result.ok ? { ok: true, value: result.value } : reviewErr(reviewError("invalid_review_run"));
}

class ReviewDomainFailure<T> extends Error {
  constructor(readonly result: ReviewResult<T>) { super("review domain failure"); }
}

function safeWrite<T>(db: StorageDatabase, work: () => ReviewResult<T>): ReviewResult<T> {
  try {
    if (db.isTransaction) return work();
    let result: ReviewResult<T> | undefined;
    withTransaction(db, () => {
      result = work();
      if (!result.ok) throw new ReviewDomainFailure(result);
    });
    return result ?? reviewErr(reviewError("review_storage_unavailable"));
  } catch (error) {
    if (error instanceof ReviewDomainFailure) return error.result;
    return reviewErr(reviewError("review_storage_unavailable"));
  }
}

function decodeRun(db: StorageDatabase, projectId: string, reviewRunId: string, data: string): ReviewResult<ReviewRun> {
  let raw: unknown;
  try { raw = JSON.parse(data); } catch { return reviewErr(reviewError("invalid_review_run")); }
  const run = parseReviewRun(raw); if (!run.ok || run.value.projectId !== projectId || run.value.id !== reviewRunId) return reviewErr(reviewError("invalid_review_run"));
  const rows = db.all<{ data: string }>(
    "SELECT data FROM review_findings WHERE project_id = ? AND review_run_id = ? ORDER BY checker_id, checker_version, finding_id",
    projectId, reviewRunId,
  );
  const findings: Finding[] = [];
  for (const row of rows) {
    try { const finding = parseFinding(JSON.parse(row.data)); if (!finding.ok) return reviewErr(reviewError("invalid_finding")); findings.push(finding.value); }
    catch { return reviewErr(reviewError("invalid_finding")); }
  }
  const expected = [...run.value.findings].sort((a, b) => a.checker.id.localeCompare(b.checker.id) || a.checker.version.localeCompare(b.checker.version) || a.id.localeCompare(b.id));
  const stored = [...findings].sort((a, b) => a.checker.id.localeCompare(b.checker.id) || a.checker.version.localeCompare(b.checker.version) || a.id.localeCompare(b.id));
  const left = encode(expected); const right = encode(stored);
  return left.ok && right.ok && left.value === right.value ? run : reviewErr(reviewError("invalid_review_run"));
}

function insertFinding(db: StorageDatabase, run: ReviewRun, finding: Finding): ReviewResult<Finding> {
  const data = encode(finding); if (!data.ok) return data;
  db.run(
    `INSERT INTO review_findings
       (finding_id, project_id, review_run_id, checker_id, checker_version, checker_kind, severity, presentation, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    finding.id, run.projectId, run.id, finding.checker.id, finding.checker.version,
    finding.checker.kind, finding.severity, finding.presentation, data.value,
  );
  return { ok: true, value: finding };
}

export function createSqliteReviewRunRepository(db: StorageDatabase): ReviewRunRepository {
  const repository: ReviewRunRepository = {
    create(value) {
      return safeWrite(db, () => {
        const run = parseReviewRun(value); if (!run.ok) return run;
        const data = encode(run.value); if (!data.ok) return data;
        db.run(
          `INSERT INTO review_runs
             (review_run_id, project_id, episode_id, snapshot_id, input_hash, status, version, started_at, completed_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          run.value.id, run.value.projectId, run.value.episodeId, run.value.snapshotId, run.value.inputHash,
          run.value.status, run.value.version, run.value.startedAt, run.value.completedAt ?? null, data.value,
        );
        for (const finding of run.value.findings) { const inserted = insertFinding(db, run.value, finding); if (!inserted.ok) return inserted; }
        return run;
      });
    },
    getById(projectIdInput, reviewRunIdInput) {
      const projectId = parseResearchIdFor(projectIdInput, "rprj_"); const reviewRunId = parseResearchIdFor(reviewRunIdInput, "rrun_");
      if (!projectId.ok || !reviewRunId.ok) return reviewErr(reviewError("invalid_review_run"));
      try {
        const row = db.get<{ data: string }>("SELECT data FROM review_runs WHERE project_id = ? AND review_run_id = ?", projectId.value.id, reviewRunId.value.id);
        return row ? decodeRun(db, projectId.value.id, reviewRunId.value.id, row.data) : { ok: true, value: undefined };
      } catch { return reviewErr(reviewError("review_storage_unavailable")); }
    },
    appendFindings(projectId, reviewRunId, findings, checkerErrors, expectedVersion) {
      return safeWrite(db, () => {
        const current = repository.getById(projectId, reviewRunId); if (!current.ok) return current; if (!current.value) return reviewErr(reviewError("review_not_found"));
        const next = appendReviewFindings(current.value, findings, checkerErrors, expectedVersion); if (!next.ok) return next;
        const data = encode(next.value); if (!data.ok) return data;
        const updated = db.run(
          "UPDATE review_runs SET version = ?, data = ? WHERE project_id = ? AND review_run_id = ? AND version = ? AND status = 'running'",
          next.value.version, data.value, projectId, reviewRunId, expectedVersion,
        );
        if (Number(updated.changes) !== 1) return reviewErr(reviewError("review_version_conflict"));
        for (const finding of findings) { const inserted = insertFinding(db, next.value, finding); if (!inserted.ok) return inserted; }
        return next;
      });
    },
    finalize(value, expectedVersionInput) {
      return safeWrite(db, () => {
        const next = parseReviewRun(value); const expectedVersion = parseEntityVersion(expectedVersionInput);
        if (!next.ok || !expectedVersion.ok || next.value.status === "running" || next.value.version !== expectedVersion.value + 1) return reviewErr(reviewError("review_version_conflict"));
        const current = repository.getById(next.value.projectId, next.value.id); if (!current.ok) return current;
        if (!current.value || current.value.status !== "running" || current.value.version !== expectedVersion.value) return reviewErr(reviewError("review_version_conflict"));
        const currentData = encode(current.value.findings); const nextData = encode(next.value.findings);
        if (!currentData.ok || !nextData.ok || currentData.value !== nextData.value) return reviewErr(reviewError("invalid_review_run"));
        const data = encode(next.value); if (!data.ok) return data;
        const updated = db.run(
          `UPDATE review_runs SET status = ?, version = ?, completed_at = ?, data = ?
           WHERE project_id = ? AND review_run_id = ? AND version = ? AND status = 'running'`,
          next.value.status, next.value.version, next.value.completedAt ?? null, data.value,
          next.value.projectId, next.value.id, expectedVersion.value,
        );
        return Number(updated.changes) === 1 ? next : reviewErr(reviewError("review_version_conflict"));
      });
    },
  };
  return Object.freeze(repository);
}
