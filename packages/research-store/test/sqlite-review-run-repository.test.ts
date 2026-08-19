import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { SequenceIdFactory } from "@sestina/research";
import {
  appendReviewFindings,
  calculateReviewInputHash,
  createFinding,
  createReviewRun,
  finalizeReviewRun,
  parseReviewContext,
} from "@sestina/review";
import { openDatabase, type StorageDatabase } from "@sestina/storage";
import { createSqliteReviewRunRepository } from "../src/index.js";
import { makeTempDir, removeTempDir } from "../../storage/test/helpers.js";

const ids = new SequenceIdFactory(3000);
const PROJECT_ID = ids.create("rprj_");
const EPISODE_ID = ids.create("repi_");
const ARTIFACT_ID = ids.create("rart_");
const BASELINE_ID = ids.create("rrev_");
const CANDIDATE_ID = ids.create("rrev_");
const BRIEF_ID = ids.create("rbrf_");
const SNAPSHOT_ID = ids.create("rsnp_");

function reviewContext() {
  const input = {
    project: { id: PROJECT_ID, version: 1 },
    episode: { id: EPISODE_ID, version: 1, artifactId: ARTIFACT_ID, baselineRevisionId: BASELINE_ID, candidateRevisionId: CANDIDATE_ID },
    baselineRevision: { id: BASELINE_ID, artifactId: ARTIFACT_ID, projectId: PROJECT_ID, contentHash: "a".repeat(64) },
    candidateRevision: { id: CANDIDATE_ID, artifactId: ARTIFACT_ID, projectId: PROJECT_ID, parentRevisionId: BASELINE_ID, contentHash: "b".repeat(64) },
    briefVersion: { id: BRIEF_ID, versionNumber: 1 }, activeDecisions: [], relevantIssues: [], evidenceBoundaries: [],
    snapshot: { id: SNAPSHOT_ID, projectId: PROJECT_ID, episodeId: EPISODE_ID, hash: "c".repeat(64) },
    checkerSet: [{ id: "scope", version: "1", kind: "deterministic" as const }],
    environmentFingerprint: "d".repeat(64), buildFingerprint: "e".repeat(64),
  };
  const parsed = parseReviewContext({ ...input, inputHash: calculateReviewInputHash(input) });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

function seedReferences(db: StorageDatabase): void {
  const at = "2026-08-19T09:00:00.000Z";
  db.run("INSERT INTO research_projects (project_id,title,root_path,version,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?)", PROJECT_ID, "p", ".", 1, at, at, "{}");
  db.run("INSERT INTO research_artifacts (artifact_id,project_id,kind,title,version,active_revision_id,tombstoned,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?,?,?,?)", ARTIFACT_ID, PROJECT_ID, "manuscript", "a", 1, null, 0, at, at, "{}");
  db.run("INSERT INTO artifact_revisions (revision_id,project_id,artifact_id,parent_revision_id,content_hash,created_at,data) VALUES (?,?,?,?,?,?,?)", BASELINE_ID, PROJECT_ID, ARTIFACT_ID, null, "a".repeat(64), at, "{}");
  db.run("INSERT INTO artifact_revisions (revision_id,project_id,artifact_id,parent_revision_id,content_hash,created_at,data) VALUES (?,?,?,?,?,?,?)", CANDIDATE_ID, PROJECT_ID, ARTIFACT_ID, BASELINE_ID, "b".repeat(64), at, "{}");
  db.run("UPDATE research_artifacts SET active_revision_id = ? WHERE artifact_id = ?", CANDIDATE_ID, ARTIFACT_ID);
  db.run("INSERT INTO revision_episodes (episode_id,project_id,artifact_id,baseline_revision_id,candidate_revision_id,status,version,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?,?,?,?)", EPISODE_ID, PROJECT_ID, ARTIFACT_ID, BASELINE_ID, CANDIDATE_ID, "accepted", 1, at, at, "{}");
  db.run("INSERT INTO research_snapshots (snapshot_id,project_id,episode_id,content_hash,created_at,data) VALUES (?,?,?,?,?,?)", SNAPSHOT_ID, PROJECT_ID, EPISODE_ID, "c".repeat(64), at, "{}");
}

describe("SQLite ReviewRun repository", () => {
  let dir: string;
  let path: string;
  let db: StorageDatabase;
  beforeEach(async () => { dir = makeTempDir("sestina-review-store-"); path = join(dir, "review.db"); db = await openDatabase({ path }); seedReferences(db); });
  afterEach(() => { db.close(); removeTempDir(dir); });

  it("appends findings, finalizes with CAS, and rebuilds after restart", async () => {
    const repository = createSqliteReviewRunRepository(db);
    const ports = { clock: { now: () => new Date("2026-08-19T09:00:00.000Z") }, idFactory: new SequenceIdFactory(3100) };
    const started = createReviewRun(reviewContext(), ports); expect(started.ok).toBe(true); if (!started.ok) return;
    expect(repository.create(started.value)).toEqual(started);
    const finding = createFinding({
      id: ports.idFactory.create("rfnd_"), kind: "scope_violation", severity: "error",
      target: { kind: "artifact", artifactId: ARTIFACT_ID }, baselineEvidence: [],
      candidateEvidence: [{ artifactId: ARTIFACT_ID, revisionId: CANDIDATE_ID, startLine: 1, endLine: 1, excerptHash: "f".repeat(64) }],
      briefVersionId: BRIEF_ID, decisionIds: [], issueIds: [], checker: { id: "scope", version: "1", kind: "deterministic" },
      confidence: { source: "rule", value: 1 }, rationale: "Candidate changed a forbidden block", minimumRecovery: "Restore the block",
      needsUserDecision: false, presentation: "foreground", provenance: { authority: "system_derived", inputHash: started.value.inputHash },
    });
    expect(finding.ok).toBe(true); if (!finding.ok) return;
    const appended = repository.appendFindings(PROJECT_ID, started.value.id, [finding.value], [], started.value.version);
    expect(appended.ok).toBe(true); if (!appended.ok) return;
    const terminal = finalizeReviewRun(appended.value, appended.value.version, ports.clock); expect(terminal.ok).toBe(true); if (!terminal.ok) return;
    expect(repository.finalize(terminal.value, appended.value.version)).toEqual(terminal);
    db.close();
    db = await openDatabase({ path });
    expect(createSqliteReviewRunRepository(db).getById(PROJECT_ID, started.value.id)).toEqual(terminal);
  });

  it("fails closed on a corrupted persisted checker kind and on stale CAS", () => {
    const repository = createSqliteReviewRunRepository(db);
    const ports = { clock: { now: () => new Date("2026-08-19T09:00:00.000Z") }, idFactory: new SequenceIdFactory(3200) };
    const started = createReviewRun(reviewContext(), ports); if (!started.ok) throw new Error(started.error.code);
    expect(repository.create(started.value).ok).toBe(true);
    expect(repository.appendFindings(PROJECT_ID, started.value.id, [], [], 99)).toMatchObject({ ok: false, error: { code: "review_version_conflict" } });
    const raw = db.get<{ data: string }>("SELECT data FROM review_runs WHERE review_run_id = ?", started.value.id);
    const corrupted = JSON.parse(raw?.data ?? "{}");
    corrupted.context.checkerSet[0].kind = "future";
    db.run("UPDATE review_runs SET data = ? WHERE review_run_id = ?", JSON.stringify(corrupted), started.value.id);
    expect(repository.getById(PROJECT_ID, started.value.id)).toMatchObject({ ok: false, error: { code: "invalid_review_run" } });
  });
});
