import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FixedClock, SequenceIdFactory } from "@sestina/research";
import { openSestina, type CoreResult, type SestinaCore } from "../src/index.js";

const USER = Object.freeze({ kind: "user" as const, actorId: "ri51-owner" });
const roots: string[] = [];
const cores: SestinaCore[] = [];

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function workspace(sequence = 25_000) {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri51-core-"));
  roots.push(root);
  const databasePath = join(root, "state.sqlite");
  const core = valueOf(await openSestina({
    databasePath,
    clock: new FixedClock("2026-08-27T09:00:00.000Z"),
    idFactory: new SequenceIdFactory(sequence),
  }));
  cores.push(core);
  const project = valueOf(core.initializeProject({ title: "RI-51 continuity", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({
    projectId: project.id,
    actor: USER,
    kind: "research_note",
    relativePath: "notes/ri51.md",
    content: "# RI-51\n\nProject continuity remains explicit and local.",
    mediaType: "text/markdown",
  }));
  const brief = valueOf(core.activateBrief({
    projectId: project.id,
    actor: USER,
    projectQuestion: "How should a local research project resume without memory pollution?",
    currentStage: "revision",
    currentTask: "Verify governed project memory and deterministic recovery.",
    targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [{ statement: "The user remains the only research Authority.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "archives" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add governed project continuity.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "A saved hint is not Authority.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Automatic memory", "Cross-project recall"],
  }));
  return { root, databasePath, core, project, brief };
}

afterEach(async () => {
  while (cores.length > 0) cores.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe("RI-51 project memory core", () => {
  it("separates canonical Project State from explicit non-authoritative Working Memory and survives restart", async () => {
    const state = await workspace();
    const empty = valueOf(state.core.getProjectMemoryProjection(state.project.id, { limit: 50 }));
    expect(empty).toMatchObject({
      schemaVersion: "1.0.0",
      projectState: { authorityClass: "kernel_authoritative_projection" },
      workingMemory: { authorityClass: "working_memory_non_authoritative", items: [], activeCount: 0 },
      resume: { authorityClass: "resume_checkpoint_non_authoritative", reviewed: false },
    });
    expect(empty.projectState.projectQuestion).toContain("resume");
    expect(empty.resume.checkpoint).toBeUndefined();
    expect(empty.resume.changes).toBeUndefined();

    const candidate = valueOf(state.core.createProjectMemoryCandidate({
      projectId: state.project.id,
      kind: "resume_note",
      content: { text: "Resume by checking the current Brief before changing direction." },
      retention: { policy: "until_unpinned" },
      sensitivity: "project_private",
      outboundPolicy: "never_send",
      publicReason: "User wrote a local resume note.",
      actor: USER,
    }));
    expect(candidate).toMatchObject({ state: "candidate", authorityClass: "working_memory_non_authoritative" });
    const active = valueOf(state.core.confirmProjectMemory({ projectId: state.project.id, itemId: candidate.id, expectedVersion: 1, publicReason: "Reviewed and confirmed.", actor: USER }));
    expect(active).toMatchObject({ state: "active", outboundPolicy: "never_send", semanticConflict: "semantic_conflict_unchecked" });

    state.core.close();
    cores.pop();
    const reopened = valueOf(await openSestina({ databasePath: state.databasePath }));
    cores.push(reopened);
    const restored = valueOf(reopened.getProjectMemoryProjection(state.project.id, { limit: 50 }));
    expect(restored.workingMemory.items[0]).toMatchObject({ id: active.id, state: "active", content: active.content });
    expect(restored.projectState.currentTask).toContain("Verify governed project memory");
  });

  it("pins only through a user-created candidate and deterministically marks source drift stale", async () => {
    const state = await workspace(27_000);
    const decision = valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "Working memory never becomes project Authority.",
      scope: { kind: "project" },
      rationale: "Continuity hints and decisions are not equivalent.",
      effectiveBriefVersionId: state.brief.currentVersionId,
      reopenConditions: ["The Authority model changes."],
      status: "accepted",
    }));
    const candidate = valueOf(state.core.createPinnedProjectMemoryCandidate({
      projectId: state.project.id,
      objectKind: "decision",
      objectId: decision.id,
      kind: "working_hint",
      content: { text: "Keep the Authority distinction visible while resuming." },
      retention: { policy: "until_unpinned" },
      sensitivity: "project_private",
      outboundPolicy: "explicit_manifest_only",
      publicReason: "User pinned this Decision as a non-authoritative working hint.",
      actor: USER,
    }));
    valueOf(state.core.confirmProjectMemory({ projectId: state.project.id, itemId: candidate.id, expectedVersion: candidate.version, publicReason: "Confirmed after preview.", actor: USER }));
    valueOf(state.core.transitionDecision({ projectId: state.project.id, decisionId: decision.id, target: "frozen", reason: "Freeze the Authority rule.", expectedVersion: decision.version, actor: USER }));

    const projection = valueOf(state.core.getProjectMemoryProjection(state.project.id, { limit: 50 }));
    expect(projection.workingMemory.items[0]).toMatchObject({ state: "stale", staleReason: "source_version_changed", recallEligible: false, manifestEligible: false });
    expect(projection.attention[0]).toMatchObject({ kind: "memory_stale", href: "/project/memory" });
  });

  it("keeps outbound zero by default and invalidates an explicit Manifest on content, Provider, or project drift", async () => {
    const state = await workspace(29_000);
    const candidate = valueOf(state.core.createProjectMemoryCandidate({
      projectId: state.project.id,
      kind: "term",
      content: { term: "Authority", definition: "Only the user can accept or redirect the research state." },
      retention: { policy: "until_unpinned" },
      sensitivity: "public",
      outboundPolicy: "explicit_manifest_only",
      publicReason: "User defined the current project term.",
      actor: USER,
    }));
    const active = valueOf(state.core.confirmProjectMemory({ projectId: state.project.id, itemId: candidate.id, expectedVersion: 1, publicReason: "Confirmed term.", actor: USER }));
    const privateCandidate = valueOf(state.core.createProjectMemoryCandidate({
      projectId: state.project.id,
      kind: "working_hint",
      content: { text: "Project-private context stays local even when selected for an external Provider." },
      retention: { policy: "until_unpinned" },
      sensitivity: "project_private",
      outboundPolicy: "explicit_manifest_only",
      publicReason: "Exercise the external sensitivity boundary.",
      actor: USER,
    }));
    const privateActive = valueOf(state.core.confirmProjectMemory({ projectId: state.project.id, itemId: privateCandidate.id, expectedVersion: 1, publicReason: "Confirmed as local project context.", actor: USER }));
    const provider = { id: "configured-primary", kind: "external" as const, configHash: "a".repeat(64), networkRequired: true };

    const zero = valueOf(state.core.prepareProjectMemoryManifest({ projectId: state.project.id, selectedItemIds: [], provider, actor: USER }));
    expect(zero.included).toEqual([]);
    expect(zero.excluded).toContainEqual(expect.objectContaining({ itemId: active.id, reason: "not_selected" }));
    expect(zero.providerPayload.items).toEqual([]);

    const prepared = valueOf(state.core.prepareProjectMemoryManifest({ projectId: state.project.id, selectedItemIds: [active.id], provider, actor: USER }));
    expect(prepared.included[0]).toMatchObject({ itemId: active.id, contentHash: active.contentHash, willLeaveDevice: true });
    expect(prepared.providerPayload.items[0]).toMatchObject({ itemId: active.id, content: active.content });
    const privateExternal = valueOf(state.core.prepareProjectMemoryManifest({ projectId: state.project.id, selectedItemIds: [privateActive.id], provider, actor: USER }));
    expect(privateExternal.included).toEqual([]);
    expect(privateExternal.excluded).toContainEqual(expect.objectContaining({ itemId: privateActive.id, reason: "sensitivity_forbids_send" }));
    const confirmed = valueOf(state.core.confirmProjectMemoryManifest({
      projectId: state.project.id,
      manifestId: prepared.manifestId,
      expectedVersion: prepared.version,
      confirmationNonce: prepared.confirmationNonce,
      manifestHash: prepared.manifestHash,
      provider,
      actor: USER,
    }));
    const consumed = valueOf(state.core.consumeProjectMemoryManifest({
      projectId: state.project.id,
      manifestId: confirmed.manifestId,
      expectedVersion: confirmed.version,
      manifestHash: confirmed.manifestHash,
      provider,
    }));
    expect(consumed.providerPayload).toEqual(prepared.providerPayload);

    const providerDrift = valueOf(state.core.prepareProjectMemoryManifest({ projectId: state.project.id, selectedItemIds: [active.id], provider, actor: USER }));
    const changedProvider = { ...provider, id: "configured-secondary", configHash: "b".repeat(64) };
    expect(state.core.confirmProjectMemoryManifest({ projectId: state.project.id, manifestId: providerDrift.manifestId, expectedVersion: providerDrift.version, confirmationNonce: providerDrift.confirmationNonce, manifestHash: providerDrift.manifestHash, provider: changedProvider, actor: USER })).toMatchObject({ ok: false, error: { code: "stale_state" } });

    const projectDrift = valueOf(state.core.prepareProjectMemoryManifest({ projectId: state.project.id, selectedItemIds: [active.id], provider, actor: USER }));
    valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "Manifest payloads never become research Authority.",
      scope: { kind: "project" },
      rationale: "A request-scoped context handoff cannot mutate the canonical project state.",
      effectiveBriefVersionId: state.brief.currentVersionId,
      reopenConditions: ["The Authority contract changes."],
      status: "accepted",
    }));
    expect(state.core.confirmProjectMemoryManifest({ projectId: state.project.id, manifestId: projectDrift.manifestId, expectedVersion: projectDrift.version, confirmationNonce: projectDrift.confirmationNonce, manifestHash: projectDrift.manifestHash, provider, actor: USER })).toMatchObject({ ok: false, error: { code: "stale_state" } });

    const second = valueOf(state.core.prepareProjectMemoryManifest({ projectId: state.project.id, selectedItemIds: [active.id], provider, actor: USER }));
    const edited = state.core.editProjectMemory({
      projectId: state.project.id,
      itemId: active.id,
      expectedVersion: active.version,
      content: { term: "Authority", definition: "The user remains the only research Authority." },
      retention: active.retention,
      sensitivity: active.sensitivity,
      outboundPolicy: active.outboundPolicy,
      publicReason: "Changed the working definition; re-confirmation is required.",
      actor: USER,
    });
    expect(edited).toMatchObject({ ok: true });
    valueOf(edited);
    expect(state.core.confirmProjectMemoryManifest({ projectId: state.project.id, manifestId: second.manifestId, expectedVersion: second.version, confirmationNonce: second.confirmationNonce, manifestHash: second.manifestHash, provider, actor: USER })).toMatchObject({ ok: false, error: { code: "stale_state" } });
  });

  it("records deterministic Resume Checkpoints and irreversibly forgets controlled current content", async () => {
    const state = await workspace(31_000);
    const candidate = valueOf(state.core.createProjectMemoryCandidate({
      projectId: state.project.id,
      kind: "working_hint",
      content: { text: "Sensitive controlled content." },
      retention: { policy: "until_unpinned" },
      sensitivity: "secret_never_send",
      outboundPolicy: "never_send",
      publicReason: "Local-only note.",
      actor: USER,
    }));
    const active = valueOf(state.core.confirmProjectMemory({ projectId: state.project.id, itemId: candidate.id, expectedVersion: 1, publicReason: "Confirmed locally.", actor: USER }));
    const checkpoint = valueOf(state.core.reviewProjectResume({ projectId: state.project.id, publicReason: "Reviewed the current recovery state.", actor: USER }));
    expect(checkpoint).toMatchObject({ authorityClass: "resume_checkpoint_non_authoritative" });

    valueOf(state.core.retireProjectMemory({ projectId: state.project.id, itemId: active.id, expectedVersion: active.version, publicReason: "No longer needed.", actor: USER }));
    const afterRetire = valueOf(state.core.getProjectMemoryProjection(state.project.id, { limit: 50 }));
    expect(afterRetire.resume.changes?.workingMemory[0]).toMatchObject({ change: "updated", id: active.id, afterState: "retired" });
    const retired = afterRetire.workingMemory.items.find((item) => item.id === active.id);
    if (retired === undefined) throw new Error("retired item missing");
    const forgotten = valueOf(state.core.forgetProjectMemory({ projectId: state.project.id, itemId: active.id, expectedVersion: retired.version, confirmation: "FORGET", publicReason: "user_requested_irreversible_forget", actor: USER }));
    expect(forgotten).toMatchObject({ schemaVersion: "1.0.0", id: active.id, projectId: state.project.id, authorityClass: "working_memory_non_authoritative", state: "forgotten", tombstone: "irreversible_forget_recorded", version: retired.version + 1 });
    expect(typeof forgotten.forgottenAt).toBe("string");
    expect(JSON.stringify(forgotten)).not.toContain("Sensitive controlled content");
  });
});
