import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SestinaCore } from "@sestina/core";
import { openDatabase, MIGRATIONS } from "@sestina/storage";
import { createResearchStore } from "@sestina/research-store";
import { FixedClock, SequenceIdFactory, createProjectWorkingMemoryCandidate, confirmProjectWorkingMemory, forgetProjectWorkingMemory, retireProjectWorkingMemory, expireProjectWorkingMemory, markProjectWorkingMemorySourceStale, createResumeCheckpoint, createClosedExternalAppPilot } from "@sestina/research";
import { makeScenario } from "legacy-scenario";
import { SyntheticProvider, USER, value } from "./factory.js";

const output = process.argv[2]!;
const epoch = "2026-08-30T00:00:00.000Z";
Date.now = () => Date.parse(epoch);
const hashes: unknown[] = [];
const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
for (const schema of [16, 17, 18, 19, 20]) {
  const directory = join(output, `schema-${schema}`, ".sestina"); await mkdir(directory, { recursive: true });
  // Caller provides a fresh output directory; no fixture is overwritten.
  const path = join(directory, "state.sqlite");
  const db = await openDatabase({ path, migrate: { migrations: MIGRATIONS.filter((m) => m.version <= schema) } });
  if (Number(db.get<{ n: number }>("SELECT count(*) n FROM research_projects")?.n) !== 0) throw new Error("Fixture output must be fresh");
  const s = makeScenario(16_000); const store = createResearchStore(db);
  value(store.projects.create(s.project)); value(store.artifacts.create(s.emptyArtifact));
  value(store.revisions.append(s.revision1)); value(store.revisions.append(s.revision2));
  value(store.briefs.create(s.brief)); value(store.decisions.create(s.decision)); value(store.issues.create(s.issue)); value(store.episodes.create(s.episode)); value(store.snapshots.create(s.snapshot));
  const clock = new FixedClock(epoch); const ids = new SequenceIdFactory(80_000); const ports = { clock, idFactory: ids };
  const core = new SestinaCore(db, clock, ids, new SyntheticProvider());
  for (const disposition of ["accepted", "modified_accepted", "rejected", "deferred", "direction_changed"] as const) {
    const p = value(core.prepareResearchRoomReview({ projectId: s.project.id, suggestion: "Retain the synthetic noncausal limitation.", evidenceClass: "synthetic_fixture", countsAsExternalEvidence: false }));
    const r = value(await core.analyzeResearchRoomSuggestion({ reviewId: p.reviewId, confirmationNonce: p.confirmationNonce, manifestHash: p.manifestHash }));
    const receipt = value(core.commitResearchRoomDisposition({ projectId: s.project.id, reviewId: r.reviewId, authorityNonce: r.authorityNonce, expectedStateBinding: r.stateBinding, disposition, reason: "Synthetic historical user outcome.", actor: USER,
      ...(disposition === "modified_accepted" ? { modifiedProposal: "A bounded synthetic modification." } : {}),
      ...(disposition === "direction_changed" ? { redirectQuestion: "Which synthetic limitation warrants investigation?" } : {}) }));
    if (disposition === "direction_changed") value(core.rollbackResearchRoomReceipt({ projectId: s.project.id, receiptId: receipt.id, expectedVersion: receipt.version, reason: "Synthetic user compensation.", actor: USER }));
  }
  if (schema >= 19) {
    for (const state of ["candidate", "active", "stale", "expired", "retired", "forgotten"] as const) {
      let memory = value(createProjectWorkingMemoryCandidate({ projectId: s.project.id, kind: "working_hint", content: { text: `Synthetic ${state} context, never evidence.` },
        source: state === "stale" ? { kind: "project_object", objectKind: "decision", objectId: s.decision.id, objectVersion: 1, contentFingerprint: "1".repeat(64) } : { kind: "direct_user", actorId: USER.actorId },
        retention: state === "expired" ? { policy: "until_date", expiresAt: "2026-08-31T00:00:00.000Z" } : { policy: "until_unpinned" }, sensitivity: "project_private", outboundPolicy: "never_send", publicReason: "Synthetic fixture.", actor: USER }, ports));
      value(store.workingMemory.create(memory));
      const apply = (next: typeof memory) => { value(store.workingMemory.compareAndSwap(next, memory.version)); memory = next; };
      if (state !== "candidate") apply(value(confirmProjectWorkingMemory(memory, { expectedVersion: memory.version, actor: USER, publicReason: "Synthetic confirm." }, ports)));
      if (state === "stale") apply(value(markProjectWorkingMemorySourceStale(memory, { sourceAvailable: false, publicReason: "Synthetic missing source." }, ports)));
      if (state === "expired") apply(value(expireProjectWorkingMemory(memory, { currentEpisodeActive: false, publicReason: "Synthetic expiration." }, { ...ports, clock: new FixedClock("2026-09-01T00:00:00.000Z") })));
      if (state === "retired") apply(value(retireProjectWorkingMemory(memory, { expectedVersion: memory.version, actor: USER, publicReason: "Synthetic retire." }, ports)));
      if (state === "forgotten") value(store.workingMemory.compareAndSwap(value(forgetProjectWorkingMemory(memory, { expectedVersion: memory.version, actor: USER, confirmation: "FORGET", publicReason: "user_requested_irreversible_forget" }, ports)), memory.version));
    }
    value(store.resumeCheckpoints.append(value(createResumeCheckpoint({ projectId: s.project.id, projectVersion: s.project.version, authorityBindings: [], memoryBindings: [], actor: USER, publicReason: "Synthetic checkpoint." }, ports))));
  }
  if (schema >= 20) value(store.closedExternalAppPilots.create(value(createClosedExternalAppPilot({ projectId: s.project.id, brief: { id: s.brief.id, versionId: s.brief.currentVersionId, version: 1 }, episode: { id: s.episode.id, version: s.episode.version }, currentTask: "Synthetic draft only.", actor: USER, evidenceClass: "synthetic_fixture" }, ports))));
  const brief = value(core.getActiveBriefProjection(s.project.id)); if (!brief) throw new Error("Missing fixture Brief");
  await writeFile(join(directory, "research-brief.yaml"), brief.yaml);
  // Freeze database bytes after checkpoint; Date and IDs are deterministic.
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); core.close();
  hashes.push({ schema, projectId: s.project.id, databaseSha256: sha(await readFile(path)), briefSha256: sha(brief.yaml), expected: { accepted: "legacy_record_only_unresolved_effect", modified_accepted: "legacy_record_only_unresolved_effect", newDecisions: 0, newEvidence: 0, migrationBaselineEvents: 1, memoryStatesPreserved: schema >= 19 } });
}
await writeFile(join(output, "hashes.json"), JSON.stringify(hashes, null, 2) + "\n");
