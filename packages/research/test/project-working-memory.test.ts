import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  computeResumeChanges,
  confirmProjectWorkingMemory,
  createProjectWorkingMemoryCandidate,
  createResumeCheckpoint,
  editProjectWorkingMemory,
  expireProjectWorkingMemory,
  forgetProjectWorkingMemory,
  isProjectWorkingMemoryRecallEligible,
  markProjectWorkingMemorySourceStale,
  parseProjectWorkingMemory,
  renewProjectWorkingMemory,
  retireProjectWorkingMemory,
  type ProjectWorkingMemory,
} from "../src/index.js";

const PROJECT_A = "rprj_00000000000000000000000001";
const PROJECT_B = "rprj_00000000000000000000000002";
const ISSUE = "riss_00000000000000000000000003";
const EPISODE = "repi_00000000000000000000000006";
const USER = Object.freeze({ kind: "user" as const, actorId: "local-researcher" });
const MODEL = Object.freeze({ kind: "model" as const, provider: "fixture", model: "proposal-only" });

function ports(at = "2026-08-27T08:00:00.000Z", seed = 20) {
  return { clock: new FixedClock(at), idFactory: new SequenceIdFactory(seed) };
}

function directTerm(): ReturnType<typeof createProjectWorkingMemoryCandidate> {
  return createProjectWorkingMemoryCandidate({
    projectId: PROJECT_A,
    kind: "term",
    content: { term: "Authority State", definition: "The user-controlled canonical research state." },
    source: { kind: "direct_user", actorId: USER.actorId },
    retention: { policy: "until_date", expiresAt: "2026-09-27T08:00:00.000Z" },
    sensitivity: "project_private",
    outboundPolicy: "explicit_manifest_only",
    publicReason: "Keep the working definition visible while this project is active.",
    actor: USER,
  }, ports());
}

describe("project working memory authority and lifecycle", () => {
  it("creates only a non-authoritative candidate and requires the same direct user to confirm it", () => {
    const created = directTerm();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      projectId: PROJECT_A,
      kind: "term",
      state: "candidate",
      authorityClass: "working_memory_non_authoritative",
      outboundPolicy: "explicit_manifest_only",
      semanticConflict: "semantic_conflict_unchecked",
      version: 1,
    });
    expect(isProjectWorkingMemoryRecallEligible(created.value, PROJECT_A, new Date("2026-08-28T00:00:00.000Z"))).toBe(false);

    const modelConfirmation = confirmProjectWorkingMemory(created.value, {
      expectedVersion: created.value.version,
      actor: MODEL,
      publicReason: "A model cannot activate project memory.",
    }, ports("2026-08-27T08:01:00.000Z"));
    expect(modelConfirmation).toMatchObject({ ok: false, error: { code: "user_working_memory_action_required" } });

    const confirmed = confirmProjectWorkingMemory(created.value, {
      expectedVersion: created.value.version,
      actor: USER,
      publicReason: "I reviewed this definition and want it available in this project.",
    }, ports("2026-08-27T08:01:00.000Z"));
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value).toMatchObject({ state: "active", version: 2, confirmedAt: "2026-08-27T08:01:00.000Z" });
    expect(isProjectWorkingMemoryRecallEligible(confirmed.value, PROJECT_A, new Date("2026-08-28T00:00:00.000Z"))).toBe(true);
    expect(isProjectWorkingMemoryRecallEligible(confirmed.value, PROJECT_B, new Date("2026-08-28T00:00:00.000Z"))).toBe(false);
  });

  it("rejects automatic Provider creation, silent permanence, invalid project scope, and always-send policy", () => {
    const invalidActor = createProjectWorkingMemoryCandidate({
      projectId: PROJECT_A,
      kind: "working_hint",
      content: { text: "Do not promote this automatically." },
      source: { kind: "direct_user", actorId: USER.actorId },
      retention: { policy: "until_unpinned" },
      sensitivity: "project_private",
      outboundPolicy: "never_send",
      publicReason: "Provider attempt",
      actor: MODEL,
    }, ports());
    expect(invalidActor).toMatchObject({ ok: false, error: { code: "user_working_memory_action_required" } });

    const raw = directTerm();
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    expect(parseProjectWorkingMemory({ ...raw.value, projectId: PROJECT_B, outboundPolicy: "always_send" })).toMatchObject({
      ok: false,
      error: { code: "invalid_project_working_memory" },
    });
  });

  it("pins a project object by frozen source version and deterministically marks source drift stale", () => {
    const candidate = createProjectWorkingMemoryCandidate({
      projectId: PROJECT_A,
      kind: "working_hint",
      content: { text: "Recheck the evidence boundary before changing the sample." },
      source: {
        kind: "project_object",
        objectKind: "issue",
        objectId: ISSUE,
        objectVersion: 3,
        contentFingerprint: "a".repeat(64),
      },
      retention: { policy: "until_unpinned" },
      sensitivity: "project_private",
      outboundPolicy: "never_send",
      publicReason: "Pin the active issue as a non-authoritative working hint.",
      actor: USER,
    }, ports());
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const active = confirmProjectWorkingMemory(candidate.value, {
      expectedVersion: candidate.value.version,
      actor: USER,
      publicReason: "I confirmed the pinned source preview.",
    }, ports("2026-08-27T08:01:00.000Z"));
    expect(active.ok).toBe(true);
    if (!active.ok) return;

    const stable = markProjectWorkingMemorySourceStale(active.value, {
      objectVersion: 3,
      contentFingerprint: "a".repeat(64),
      sourceAvailable: true,
      publicReason: "Source still matches.",
    }, ports("2026-08-27T08:02:00.000Z"));
    expect(stable).toMatchObject({ ok: true, value: { state: "active", version: 2 } });

    const stale = markProjectWorkingMemorySourceStale(active.value, {
      objectVersion: 4,
      contentFingerprint: "b".repeat(64),
      sourceAvailable: true,
      publicReason: "The source object changed from version 3 to version 4.",
    }, ports("2026-08-27T08:02:00.000Z"));
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.value).toMatchObject({ state: "stale", version: 3, staleReason: "source_version_changed" });
    expect(isProjectWorkingMemoryRecallEligible(stale.value, PROJECT_A, new Date("2026-08-27T08:03:00.000Z"))).toBe(false);
    const reconciledAgain = markProjectWorkingMemorySourceStale(stale.value, {
      objectVersion: 4,
      contentFingerprint: "b".repeat(64),
      sourceAvailable: true,
      publicReason: "The same source drift remains visible.",
    }, ports("2026-08-27T08:04:00.000Z"));
    expect(reconciledAgain).toMatchObject({ ok: true, value: { state: "stale", version: 3, staleReason: "source_version_changed" } });
  });

  it("requires edit followed by reconfirmation and rejects stale CAS", () => {
    const created = directTerm();
    if (!created.ok) throw new Error("fixture failed");
    const active = confirmProjectWorkingMemory(created.value, { expectedVersion: 1, actor: USER, publicReason: "confirmed" }, ports("2026-08-27T08:01:00.000Z"));
    if (!active.ok) throw new Error("fixture failed");
    const edited = editProjectWorkingMemory(active.value, {
      expectedVersion: 2,
      content: { term: "Authority State", definition: "Only user-confirmed canonical research state." },
      retention: { policy: "until_date", expiresAt: "2026-10-01T00:00:00.000Z" },
      sensitivity: "sensitive",
      outboundPolicy: "never_send",
      publicReason: "Clarify the definition and keep it local.",
      actor: USER,
    }, ports("2026-08-27T08:02:00.000Z"));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value).toMatchObject({ state: "candidate", version: 3, outboundPolicy: "never_send" });
    expect(edited.value.confirmedAt).toBeUndefined();
    const staleWrite = confirmProjectWorkingMemory(edited.value, { expectedVersion: 2, actor: USER, publicReason: "stale" }, ports("2026-08-27T08:03:00.000Z"));
    expect(staleWrite).toMatchObject({ ok: false, error: { code: "version_conflict" } });
  });

  it("expires, renews, retires, and irreversibly forgets without retaining recoverable content or fingerprints", () => {
    const created = directTerm();
    if (!created.ok) throw new Error("fixture failed");
    const active = confirmProjectWorkingMemory(created.value, { expectedVersion: 1, actor: USER, publicReason: "confirmed" }, ports("2026-08-27T08:01:00.000Z"));
    if (!active.ok) throw new Error("fixture failed");
    const expired = expireProjectWorkingMemory(active.value, { currentEpisodeActive: true, publicReason: "The explicit retention date passed." }, ports("2026-09-28T08:00:00.000Z"));
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.value).toMatchObject({ state: "expired", version: 3 });
    const renewed = renewProjectWorkingMemory(expired.value, {
      expectedVersion: 3,
      retention: { policy: "until_unpinned" },
      actor: USER,
      publicReason: "Keep this definition until I explicitly unpin it.",
    }, ports("2026-09-28T08:01:00.000Z"));
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.value).toMatchObject({ state: "active", version: 4 });
    const retired = retireProjectWorkingMemory(renewed.value, { expectedVersion: 4, actor: USER, publicReason: "No longer needed for active work." }, ports("2026-09-28T08:02:00.000Z"));
    expect(retired.ok).toBe(true);
    if (!retired.ok) return;
    expect(retired.value).toMatchObject({ state: "retired", version: 5 });
    const forgotten = forgetProjectWorkingMemory(retired.value, { expectedVersion: 5, actor: USER, confirmation: "FORGET", publicReason: "user_requested_irreversible_forget" }, ports("2026-09-28T08:03:00.000Z"));
    expect(forgotten.ok).toBe(true);
    if (!forgotten.ok) return;
    expect(forgotten.value).toEqual({
      schemaVersion: "1.0.0",
      id: retired.value.id,
      projectId: PROJECT_A,
      authorityClass: "working_memory_non_authoritative",
      state: "forgotten",
      tombstone: "irreversible_forget_recorded",
      forgottenAt: "2026-09-28T08:03:00.000Z",
      version: 6,
    });
    const serialized = JSON.stringify(forgotten.value);
    expect(serialized).not.toContain("Authority State");
    expect(serialized).not.toContain("a".repeat(64));
    expect(parseProjectWorkingMemory(forgotten.value)).toEqual(forgotten);
  });

  it("expires a current-episode workset exactly when its bound Episode is no longer active", () => {
    const candidate = createProjectWorkingMemoryCandidate({
      projectId: PROJECT_A,
      kind: "workset",
      content: { purpose: "Resume the bounded Episode workset.", refs: [{ kind: "issue", id: ISSUE, version: 3 }] },
      source: { kind: "direct_user", actorId: USER.actorId },
      retention: { policy: "current_episode", episodeId: EPISODE },
      sensitivity: "project_private",
      outboundPolicy: "never_send",
      publicReason: "Bind this explicit workset to the current Episode.",
      actor: USER,
    }, ports());
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const active = confirmProjectWorkingMemory(candidate.value, { expectedVersion: candidate.value.version, actor: USER, publicReason: "Reviewed the Episode workset." }, ports("2026-08-27T08:01:00.000Z"));
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect(expireProjectWorkingMemory(active.value, { currentEpisodeActive: true, publicReason: "The bound Episode remains current." }, ports("2026-08-27T08:02:00.000Z"))).toMatchObject({ ok: true, value: { state: "active", version: 2 } });
    expect(expireProjectWorkingMemory(active.value, { currentEpisodeActive: false, publicReason: "The bound Episode is no longer current." }, ports("2026-08-27T08:03:00.000Z"))).toMatchObject({ ok: true, value: { state: "expired", version: 3 } });
  });
});

describe("resume checkpoint", () => {
  function activeMemory(): ProjectWorkingMemory {
    const candidate = directTerm();
    if (!candidate.ok) throw new Error("fixture failed");
    const active = confirmProjectWorkingMemory(candidate.value, { expectedVersion: 1, actor: USER, publicReason: "confirmed" }, ports("2026-08-27T08:01:00.000Z"));
    if (!active.ok) throw new Error("fixture failed");
    return active.value;
  }

  it("records a user-reviewed deterministic snapshot without becoming authority", () => {
    const memory = activeMemory();
    const checkpoint = createResumeCheckpoint({
      projectId: PROJECT_A,
      projectVersion: 7,
      authorityBindings: [
        { kind: "brief", id: "rbrf_00000000000000000000000004", version: 3 },
        { kind: "issue", id: ISSUE, version: 3 },
      ],
      memoryBindings: [{ id: memory.id, version: memory.version, state: memory.state }],
      actor: USER,
      publicReason: "I reviewed the current project state and working memory.",
    }, ports("2026-08-27T09:00:00.000Z", 80));
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) return;
    expect(checkpoint.value).toMatchObject({
      projectId: PROJECT_A,
      authorityClass: "resume_checkpoint_non_authoritative",
      projectVersion: 7,
      reviewedAt: "2026-08-27T09:00:00.000Z",
      version: 1,
    });

    const changes = computeResumeChanges(checkpoint.value, {
      projectId: PROJECT_A,
      projectVersion: 9,
      authorityBindings: [
        { kind: "brief", id: "rbrf_00000000000000000000000004", version: 4 },
        { kind: "decision", id: "rdec_00000000000000000000000005", version: 1 },
      ],
      memoryBindings: [{ id: memory.id, version: 3, state: "stale" }],
    });
    expect(changes.ok).toBe(true);
    if (!changes.ok) return;
    expect(changes.value.projectChanged).toBe(true);
    expect(changes.value.authority).toEqual([
      { change: "updated", kind: "brief", id: "rbrf_00000000000000000000000004", beforeVersion: 3, afterVersion: 4 },
      { change: "added", kind: "decision", id: "rdec_00000000000000000000000005", afterVersion: 1 },
      { change: "removed", kind: "issue", id: ISSUE, beforeVersion: 3 },
    ]);
    expect(changes.value.workingMemory).toEqual([
      { change: "updated", id: memory.id, beforeVersion: 2, afterVersion: 3, beforeState: "active", afterState: "stale" },
    ]);
    expect(changes.value.summaryAuthority).toBe("system_derived_deterministic_non_authoritative");
  });
});
