import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FixedClock, SequenceIdFactory } from "@sestina/research";
import { openSestina, type CoreResult, type SestinaCore } from "../src/index.js";

const USER = Object.freeze({ kind: "user" as const, actorId: "ri52-owner" });
const roots: string[] = [];
const cores: SestinaCore[] = [];

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function workspace(sequence = 52_000) {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri52-core-")); roots.push(root);
  const databasePath = join(root, "state.sqlite");
  const core = valueOf(await openSestina({ databasePath, clock: new FixedClock("2026-08-28T01:00:00.000Z"), idFactory: new SequenceIdFactory(sequence) })); cores.push(core);
  const project = valueOf(core.initializeProject({ title: "RI-52 closed pilot", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({ projectId: project.id, actor: USER, kind: "research_note", relativePath: "notes/ri52.md", content: "# Synthetic\n\nBounded host handoff.", mediaType: "text/markdown" }));
  const brief = valueOf(core.activateBrief({
    projectId: project.id, actor: USER, projectQuestion: "Can a closed host handoff preserve research Authority?", currentStage: "revision", currentTask: "Review one bounded external candidate.", targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [{ statement: "Only the user can change research Authority.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }], forbiddenChanges: [{ target: { kind: "project_path", relativePath: "archive" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add one bounded uncertainty statement.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "Host output remains proposal-only.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }], explicitNonGoals: ["Automatic acceptance", "Write MCP"],
  }));
  const decision = valueOf(core.recordDecision({ projectId: project.id, actor: USER, statement: "Codex output is proposal-only.", scope: { kind: "project" }, rationale: "The host is not Authority.", effectiveBriefVersionId: brief.currentVersionId, reopenConditions: ["The Authority contract changes."], status: "accepted" }));
  const episode = valueOf(core.startRevisionEpisode({ projectId: project.id, artifactId: artifact.artifact.id, briefVersionId: brief.currentVersionId, baselineRevisionId: artifact.revision.id, actor: USER }));
  return { root, databasePath, core, project, artifact, brief, decision, episode };
}

afterEach(async () => {
  while (cores.length > 0) cores.pop()?.close();
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }); }));
});

describe("RI-52 closed external app Pilot core", () => {
  it("runs proposal import through the existing Review and user Authority Gate, then verifies a fresh-session continuity binding", async () => {
    const state = await workspace();
    const selectedCandidate = valueOf(state.core.createProjectMemoryCandidate({ projectId: state.project.id, kind: "working_hint", content: { text: "Expose only this explicitly selected hint." }, retention: { policy: "until_unpinned" }, sensitivity: "project_private", outboundPolicy: "explicit_manifest_only", publicReason: "Synthetic selected memory.", actor: USER }));
    const selected = valueOf(state.core.confirmProjectMemory({ projectId: state.project.id, itemId: selectedCandidate.id, expectedVersion: selectedCandidate.version, publicReason: "Selected for explicit disclosure.", actor: USER }));
    const secretCandidate = valueOf(state.core.createProjectMemoryCandidate({ projectId: state.project.id, kind: "working_hint", content: { text: "Never send this controlled local note." }, retention: { policy: "until_unpinned" }, sensitivity: "secret_never_send", outboundPolicy: "never_send", publicReason: "Synthetic secret memory.", actor: USER }));
    valueOf(state.core.confirmProjectMemory({ projectId: state.project.id, itemId: secretCandidate.id, expectedVersion: secretCandidate.version, publicReason: "Keep local.", actor: USER }));

    let pilot = valueOf(state.core.createClosedExternalAppPilot({ projectId: state.project.id, evidenceClass: "synthetic_fixture", actor: USER }));
    pilot = valueOf(state.core.recordClosedExternalAppPilotPreflight({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, availability: "available", supportedVersion: "codex-cli 0.150.0", verifiedAt: "2026-08-28T01:00:00.000Z", capabilities: { start: "observed", structuredOutput: "unproven", mcp: "unproven", readOnlySandbox: "unproven", cancellation: "unproven", contextIsolation: "unproven" } }));
    pilot = valueOf(state.core.prepareClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, kind: "candidate_generation", selectedMemoryItemIds: [selected.id], confirmationExpiresAt: "2026-08-28T01:15:00.000Z", externalModelServiceMayBeCalled: true, timeoutMs: 120_000, outputLimitBytes: 65_536, actor: USER }));
    const candidateManifest = pilot.manifests[0]; const candidateAttempt = pilot.attempts[0];
    expect(candidateManifest).toBeDefined(); expect(candidateAttempt).toBeDefined(); if (!candidateManifest || !candidateAttempt) return;
    expect(JSON.parse(candidateManifest.payloadUtf8)).toEqual(candidateManifest.payload);
    expect(candidateManifest.payloadBytes).toBe(Buffer.byteLength(candidateManifest.payloadUtf8, "utf8"));
    expect(candidateManifest.workingMemorySelection).toEqual({ defaultSelectedCount: 0, selectedIds: [selected.id], neverSendIncludedCount: 0 });
    expect(candidateManifest.payload.workingMemory.map((item) => item.id)).toEqual([selected.id]);
    expect(candidateManifest.excluded).toContainEqual(expect.objectContaining({ id: secretCandidate.id, reason: "never_send" }));

    pilot = valueOf(state.core.confirmClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: candidateAttempt.id, manifestId: candidateManifest.id, manifestHash: candidateManifest.payloadHash, confirmationNonce: candidateAttempt.confirmationNonce, actor: USER }));
    pilot = valueOf(state.core.startClosedExternalAppPilotAttempt({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: candidateAttempt.id, manifestHash: candidateManifest.payloadHash }));
    const invocationId = pilot.attempts[0]?.invocationId; expect(invocationId).toBeDefined(); if (!invocationId) return;
    pilot = valueOf(state.core.markClosedExternalAppPilotAttemptRunning({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: candidateAttempt.id, invocationId }));
    pilot = valueOf(state.core.receiveClosedExternalAppPilotCandidate({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: candidateAttempt.id, invocationId, manifestHash: candidateManifest.payloadHash, mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: candidateManifest.payloadHash }, candidate: { candidateMarkdown: "# Synthetic\n\nAdd a bounded uncertainty statement.", materialDelta: "Adds an explicit uncertainty statement.", preservedDecisionIds: [state.decision.id], affectedIssueIds: [], evidenceUsed: [], unknowns: ["External user value remains unproven."], reopenResolvedIssue: false, authority: "model_proposed", canMutateAuthority: false }, stdoutBytes: 400, stderrBytes: 0, usage: "unavailable" }));
    expect(pilot.status).toBe("candidate_confirmation_required");
    expect(valueOf(state.core.getAttentionProjection(state.project.id)).items).toContainEqual(expect.objectContaining({ id: pilot.id, kind: "external_app_pilot", href: `/project/external-app-pilot/${pilot.id}` }));
    expect(valueOf(state.core.searchResearchObjects(state.project.id, { query: "Codex Pilot", limit: 20 })).items).toContainEqual(expect.objectContaining({ id: pilot.id, kind: "external_app_pilot", status: "candidate_confirmation_required" }));
    const imported = valueOf(state.core.importClosedExternalAppPilotCandidate({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, actor: USER }));
    pilot = imported.pilot;
    expect(pilot.status).toBe("user_disposition_required");
    expect(imported.review.providerStatus).toBe("ledger_only");
    expect(pilot.candidate).toMatchObject({ status: "imported", authority: "model_proposed", canMutateAuthority: false });
    expect(valueOf(state.core.getResearchRoomState(state.project.id)).brief.projectQuestion).toContain("closed host handoff");

    const restored = valueOf(state.core.restoreClosedExternalAppPilotReview({ projectId: state.project.id, pilotId: pilot.id, expectedPilotVersion: pilot.version, actor: USER }));
    pilot = restored.pilot;
    expect(restored.review.reviewId).not.toBe(imported.review.reviewId);
    expect(pilot).toMatchObject({ status: "user_disposition_required", review: { reviewId: restored.review.reviewId, importedRevisionId: imported.revision.id } });
    const analyzed = valueOf(await state.core.analyzeResearchRoomSuggestion({ reviewId: restored.review.reviewId, confirmationNonce: restored.review.confirmationNonce, manifestHash: restored.review.manifestHash }));
    expect(analyzed.providerStatus).toBe("ledger_only");
    const disposition = valueOf(state.core.commitClosedExternalAppPilotDisposition({ projectId: state.project.id, pilotId: pilot.id, expectedPilotVersion: pilot.version, reviewId: analyzed.reviewId, authorityNonce: analyzed.authorityNonce, expectedStateBinding: analyzed.stateBinding, disposition: "deferred", reason: "The owner defers this proposal after deterministic ledger review.", actor: USER }));
    pilot = disposition.pilot;
    expect(pilot).toMatchObject({ status: "continuity_check_ready", disposition: { decidedBy: "user", receiptId: disposition.receipt.id } });

    pilot = valueOf(state.core.prepareClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, kind: "continuity_check", selectedMemoryItemIds: [], confirmationExpiresAt: "2026-08-28T01:15:00.000Z", externalModelServiceMayBeCalled: true, timeoutMs: 120_000, outputLimitBytes: 65_536, actor: USER }));
    const continuityManifest = pilot.manifests[1]; const continuityAttempt = pilot.attempts[1];
    expect(continuityManifest).toBeDefined(); expect(continuityAttempt).toBeDefined(); if (!continuityManifest || !continuityAttempt) return;
    expect(continuityManifest.payload.workingMemory).toEqual([]);
    pilot = valueOf(state.core.confirmClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: continuityAttempt.id, manifestId: continuityManifest.id, manifestHash: continuityManifest.payloadHash, confirmationNonce: continuityAttempt.confirmationNonce, actor: USER }));
    pilot = valueOf(state.core.startClosedExternalAppPilotAttempt({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: continuityAttempt.id, manifestHash: continuityManifest.payloadHash }));
    const continuityInvocation = pilot.attempts[1]?.invocationId; if (!continuityInvocation) throw new Error("missing continuity invocation");
    pilot = valueOf(state.core.markClosedExternalAppPilotAttemptRunning({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: continuityAttempt.id, invocationId: continuityInvocation }));
    pilot = valueOf(state.core.completeClosedExternalAppPilotContinuity({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: continuityAttempt.id, invocationId: continuityInvocation, manifestHash: continuityManifest.payloadHash, observation: { authority: "host_observation", canMutateAuthority: false, projectId: state.project.id, briefId: continuityManifest.payload.brief.id, briefVersion: continuityManifest.payload.brief.version, episodeId: continuityManifest.payload.episode.id, episodeStatus: continuityManifest.payload.episode.status, decisionStates: continuityManifest.payload.decisions.map(({ id, status }) => ({ id, status })), issueStates: continuityManifest.payload.issues.map(({ id, status }) => ({ id, status, treatAsOpenAudit: false, reopenProposed: false })), canonicalStateHash: continuityManifest.payload.projectStateHash, mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: continuityManifest.payloadHash } } }));
    expect(pilot.status).toBe("continuity_verified");
    pilot = valueOf(state.core.closeClosedExternalAppPilot({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, actor: USER }));
    const evidence = valueOf(state.core.exportClosedExternalAppPilotEvidence(state.project.id, pilot.id));
    expect(evidence).toMatchObject({ stableOutcome: "closed", authorityMutationCount: 0, automaticRetryCount: 0, externalUserEvidenceCount: 0, stages: { continuityVerified: true, dispositionRecorded: true } });
    expect(JSON.stringify(evidence)).not.toContain("bounded uncertainty statement");
    expect(JSON.stringify(evidence)).not.toContain(state.root);
  });

  it("requires one exact confirmation, rejects late results after cancel, and recovers an uncertain invocation without retry", async () => {
    const state = await workspace(62_000);
    let pilot = valueOf(state.core.createClosedExternalAppPilot({ projectId: state.project.id, evidenceClass: "synthetic_fixture", actor: USER }));
    pilot = valueOf(state.core.recordClosedExternalAppPilotPreflight({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, availability: "available", supportedVersion: "codex-cli 0.150.0", capabilities: { start: "observed", structuredOutput: "unproven", mcp: "unproven", readOnlySandbox: "unproven", cancellation: "unproven", contextIsolation: "unproven" } }));
    pilot = valueOf(state.core.prepareClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, kind: "candidate_generation", selectedMemoryItemIds: [], confirmationExpiresAt: "2026-08-28T01:15:00.000Z", externalModelServiceMayBeCalled: true, timeoutMs: 120_000, outputLimitBytes: 65_536, actor: USER }));
    const manifest = pilot.manifests[0]; const attempt = pilot.attempts[0]; if (!manifest || !attempt) throw new Error("missing attempt");
    expect(state.core.startClosedExternalAppPilotAttempt({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: attempt.id, manifestHash: manifest.payloadHash })).toMatchObject({ ok: false });
    pilot = valueOf(state.core.confirmClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: attempt.id, manifestId: manifest.id, manifestHash: manifest.payloadHash, confirmationNonce: attempt.confirmationNonce, actor: USER }));
    expect(state.core.confirmClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: attempt.id, manifestId: manifest.id, manifestHash: manifest.payloadHash, confirmationNonce: attempt.confirmationNonce, actor: USER })).toMatchObject({ ok: false });
    pilot = valueOf(state.core.startClosedExternalAppPilotAttempt({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: attempt.id, manifestHash: manifest.payloadHash }));
    const invocationId = pilot.attempts[0]?.invocationId; if (!invocationId) throw new Error("missing invocation");
    pilot = valueOf(state.core.markClosedExternalAppPilotAttemptRunning({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: attempt.id, invocationId }));
    pilot = valueOf(state.core.cancelClosedExternalAppPilotAttempt({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: attempt.id, actor: USER }));
    expect(state.core.receiveClosedExternalAppPilotCandidate({ projectId: state.project.id, pilotId: pilot.id, expectedVersion: pilot.version, attemptId: attempt.id, invocationId, manifestHash: manifest.payloadHash, mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: manifest.payloadHash }, candidate: { candidateMarkdown: "late", materialDelta: "late", preservedDecisionIds: [], affectedIssueIds: [], evidenceUsed: [], unknowns: [], reopenResolvedIssue: false, authority: "model_proposed", canMutateAuthority: false }, usage: "unavailable" })).toMatchObject({ ok: false });

    let interrupted = valueOf(state.core.createClosedExternalAppPilot({ projectId: state.project.id, evidenceClass: "synthetic_fixture", actor: USER }));
    interrupted = valueOf(state.core.recordClosedExternalAppPilotPreflight({ projectId: state.project.id, pilotId: interrupted.id, expectedVersion: interrupted.version, availability: "available", supportedVersion: "codex-cli 0.150.0", capabilities: { start: "observed", structuredOutput: "unproven", mcp: "unproven", readOnlySandbox: "unproven", cancellation: "unproven", contextIsolation: "unproven" } }));
    interrupted = valueOf(state.core.prepareClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: interrupted.id, expectedVersion: interrupted.version, kind: "candidate_generation", selectedMemoryItemIds: [], confirmationExpiresAt: "2026-08-28T01:15:00.000Z", externalModelServiceMayBeCalled: true, timeoutMs: 120_000, outputLimitBytes: 65_536, actor: USER }));
    const interruptedManifest = interrupted.manifests[0]; const interruptedAttempt = interrupted.attempts[0]; if (!interruptedManifest || !interruptedAttempt) throw new Error("missing interrupted attempt");
    interrupted = valueOf(state.core.confirmClosedExternalAppPilotContext({ projectId: state.project.id, pilotId: interrupted.id, expectedVersion: interrupted.version, attemptId: interruptedAttempt.id, manifestId: interruptedManifest.id, manifestHash: interruptedManifest.payloadHash, confirmationNonce: interruptedAttempt.confirmationNonce, actor: USER }));
    valueOf(state.core.startClosedExternalAppPilotAttempt({ projectId: state.project.id, pilotId: interrupted.id, expectedVersion: interrupted.version, attemptId: interruptedAttempt.id, manifestHash: interruptedManifest.payloadHash }));
    state.core.close(); cores.pop();
    const reopened = valueOf(await openSestina({ databasePath: state.databasePath, clock: new FixedClock("2026-08-28T01:02:00.000Z"), idFactory: new SequenceIdFactory(72_000) })); cores.push(reopened);
    const recovered = valueOf(reopened.getClosedExternalAppPilot(state.project.id, interrupted.id));
    expect(recovered).toMatchObject({ status: "interrupted_unknown", failure: { code: "invocation_interrupted_after_restart" }, invocationBudget: { automaticRetries: 0 } });
  });
});
