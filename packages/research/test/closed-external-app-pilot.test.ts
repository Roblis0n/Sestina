import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  bindClosedPilotDisposition,
  bindClosedPilotReview,
  cancelClosedPilotAttempt,
  closeClosedExternalAppPilot,
  completeClosedPilotContinuity,
  confirmClosedPilotContext,
  createClosedExternalAppPilot,
  createClosedPilotEvidenceExport,
  importClosedPilotCandidate,
  markClosedPilotAttemptRunning,
  prepareClosedPilotContext,
  receiveClosedPilotCandidate,
  recordClosedPilotPreflight,
  recoverInterruptedClosedPilot,
  requireClosedPilotCandidateConfirmation,
  startClosedPilotAttempt,
  type ClosedExternalAppPilot,
  type PrepareClosedPilotContextInput,
} from "../src/index.js";

const USER = { kind: "user" as const, actorId: "local-user" };
const HOST = { kind: "agent" as const, actorId: "codex-host" };
const PROJECT_ID = "rprj_00000000000000000000000001";
const BRIEF_ID = "rbrf_00000000000000000000000002";
const BRIEF_VERSION_ID = "rbrf_00000000000000000000000003";
const EPISODE_ID = "repi_00000000000000000000000004";
const DECISION_ID = "rdec_00000000000000000000000005";
const ISSUE_ID = "riss_00000000000000000000000006";
const EVIDENCE_ID = "revd_00000000000000000000000007";
const MEMORY_ID = "rmem_00000000000000000000000008";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function ports(seed = 100, at = "2026-08-28T02:00:00.000Z") {
  return { clock: new FixedClock(at), idFactory: new SequenceIdFactory(seed) };
}

function createPilot(): ClosedExternalAppPilot {
  return value(createClosedExternalAppPilot({
    projectId: PROJECT_ID,
    brief: { id: BRIEF_ID, versionId: BRIEF_VERSION_ID, version: 1 },
    episode: { id: EPISODE_ID, version: 1 },
    currentTask: "Review the causal wording without changing the accepted evidence boundary.",
    actor: USER,
    evidenceClass: "synthetic_fixture",
  }, ports()));
}

function contextInput(kind: "candidate_generation" | "continuity_check" = "candidate_generation"): PrepareClosedPilotContextInput {
  return {
    kind,
    projectStateHash: "a".repeat(64),
    brief: {
      id: BRIEF_ID,
      versionId: BRIEF_VERSION_ID,
      version: kind === "candidate_generation" ? 1 : 2,
      projectQuestion: "Does the evidence justify a causal claim?",
    },
    episode: { id: EPISODE_ID, version: kind === "candidate_generation" ? 1 : 4, status: kind === "candidate_generation" ? "active" : "accepted" },
    currentTask: kind === "candidate_generation" ? "Review the causal wording without changing the accepted evidence boundary." : "Verify the post-disposition canonical state.",
    decisions: [{ id: DECISION_ID, version: 2, status: "accepted", statement: "Keep the evidence boundary fixed." }],
    issues: [{ id: ISSUE_ID, version: kind === "candidate_generation" ? 1 : 3, status: kind === "candidate_generation" ? "open" : "resolved", summary: "Causal wording exceeds the evidence.", resolutionRecorded: kind === "continuity_check", reopenCondition: "Only new causal evidence permits reopening." }],
    evidence: [{ id: EVIDENCE_ID, version: 1, summary: "Synthetic association evidence.", source: "project_evidence", sensitivity: "project_private" }],
    workingMemory: [{ id: MEMORY_ID, version: 2, kind: "working_hint", content: "Keep the distinction between association and causation visible.", source: "direct_user", sensitivity: "project_private", outboundPolicy: "explicit_manifest_only" }],
    excluded: [
      { category: "working_memory", id: "rmem_00000000000000000000000009", reason: "never_send", source: "project_memory", sensitivity: "secret_never_send" },
      { category: "provider_secret", reason: "credentials_never_in_context", source: "local_configuration", sensitivity: "secret_never_send" },
    ],
    disclosure: {
      externalModelServiceMayBeCalled: true,
      hostCan: ["read_the_frozen_context", "return_one_structured_observation"],
      hostCannot: ["write_project", "mutate_authority", "retry_automatically"],
      timeoutMs: 120_000,
      outputLimitBytes: 65_536,
    },
    confirmationExpiresAt: "2026-08-28T02:15:00.000Z",
    actor: USER,
  };
}

function readyPilot(): ClosedExternalAppPilot {
  const pilot = createPilot();
  return value(recordClosedPilotPreflight(pilot, {
    expectedVersion: pilot.version,
    availability: "available",
    supportedVersion: "0.148.0",
    verifiedAt: "2026-08-28T01:59:00.000Z",
    capabilities: {
      start: "observed",
      structuredOutput: "observed",
      mcp: "observed",
      readOnlySandbox: "observed",
      cancellation: "observed",
      contextIsolation: "observed",
    },
  }, ports(200)));
}

function runningCandidatePilot(): ClosedExternalAppPilot {
  const preflight = readyPilot();
  const prepared = value(prepareClosedPilotContext(preflight, { ...contextInput(), expectedVersion: preflight.version }, ports(300)));
  const attempt = prepared.attempts[0]!;
  const confirmed = value(confirmClosedPilotContext(prepared, {
    expectedVersion: prepared.version,
    attemptId: attempt.id,
    manifestId: attempt.manifestId,
    manifestHash: attempt.manifestHash,
    confirmationNonce: attempt.confirmationNonce,
    actor: USER,
  }, ports(400, "2026-08-28T02:05:00.000Z")));
  const launched = value(startClosedPilotAttempt(confirmed, {
    expectedVersion: confirmed.version,
    attemptId: attempt.id,
    manifestHash: attempt.manifestHash,
  }, ports(500, "2026-08-28T02:06:00.000Z")));
  return value(markClosedPilotAttemptRunning(launched, {
    expectedVersion: launched.version,
    attemptId: attempt.id,
    invocationId: launched.attempts[0]!.invocationId!,
  }, ports(600, "2026-08-28T02:06:01.000Z")));
}

describe("RI-52 ClosedExternalAppPilot domain", () => {
  it("creates a Codex-only, project-bound, proposal-only aggregate and records honest preflight", () => {
    const pilot = createPilot();
    expect(pilot).toMatchObject({ host: "codex", status: "draft", authority: "external_host_proposal_only", canMutateAuthority: false, version: 1 });
    const blocked = value(recordClosedPilotPreflight(pilot, {
      expectedVersion: pilot.version,
      availability: "unavailable",
      supportedVersion: null,
      capabilities: { start: "unavailable", structuredOutput: "unproven", mcp: "unproven", readOnlySandbox: "unproven", cancellation: "unproven", contextIsolation: "unproven" },
    }, ports(201)));
    expect(blocked.status).toBe("blocked_host_unavailable");
    expect(blocked.failure?.code).toBe("host_unavailable");
  });

  it("freezes preview bytes exactly, excludes never_send content, and binds one nonce to one attempt/hash", () => {
    const preflight = readyPilot();
    const prepared = value(prepareClosedPilotContext(preflight, { ...contextInput(), expectedVersion: preflight.version }, ports(301)));
    const attempt = prepared.attempts[0]!;
    const manifest = prepared.manifests[0]!;
    expect(prepared.status).toBe("context_confirmation_required");
    expect(manifest.payloadBytes).toBe(new TextEncoder().encode(manifest.payloadUtf8).byteLength);
    expect(manifest.payloadUtf8).toContain(MEMORY_ID);
    expect(manifest.payloadUtf8).not.toContain("rmem_00000000000000000000000009");
    expect(manifest.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "never_send" })]));

    const confirmed = value(confirmClosedPilotContext(prepared, { expectedVersion: prepared.version, attemptId: attempt.id, manifestId: manifest.id, manifestHash: manifest.payloadHash, confirmationNonce: attempt.confirmationNonce, actor: USER }, ports(401, "2026-08-28T02:05:00.000Z")));
    expect(confirmed.status).toBe("context_confirmed");
    expect(confirmClosedPilotContext(confirmed, { expectedVersion: confirmed.version, attemptId: attempt.id, manifestId: manifest.id, manifestHash: manifest.payloadHash, confirmationNonce: attempt.confirmationNonce, actor: USER }, ports(402, "2026-08-28T02:05:01.000Z"))).toMatchObject({ ok: false, error: { code: "pilot_confirmation_replayed" } });
    expect(confirmClosedPilotContext(prepared, { expectedVersion: prepared.version, attemptId: attempt.id, manifestId: manifest.id, manifestHash: "b".repeat(64), confirmationNonce: attempt.confirmationNonce, actor: USER }, ports(403, "2026-08-28T02:05:00.000Z"))).toMatchObject({ ok: false, error: { code: "pilot_context_mismatch" } });
    expect(confirmClosedPilotContext(prepared, { expectedVersion: prepared.version, attemptId: attempt.id, manifestId: manifest.id, manifestHash: manifest.payloadHash, confirmationNonce: attempt.confirmationNonce, actor: HOST }, ports(404, "2026-08-28T02:05:00.000Z"))).toMatchObject({ ok: false, error: { code: "user_pilot_action_required" } });
  });

  it("accepts one strict model_proposed candidate but import is not acceptance or disposition", () => {
    const running = runningCandidatePilot();
    const attempt = running.attempts[0]!;
    const received = value(receiveClosedPilotCandidate(running, {
      expectedVersion: running.version,
      attemptId: attempt.id,
      invocationId: attempt.invocationId!,
      manifestHash: attempt.manifestHash,
      mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: attempt.manifestHash },
      candidate: {
        candidateMarkdown: "Replace the causal sentence with an association-bounded statement.",
        materialDelta: "Removes unsupported causal force while preserving the evidence boundary.",
        preservedDecisionIds: [DECISION_ID],
        affectedIssueIds: [ISSUE_ID],
        evidenceUsed: [EVIDENCE_ID],
        unknowns: ["Whether later causal evidence exists."],
        reopenResolvedIssue: false,
        authority: "model_proposed",
        canMutateAuthority: false,
      },
    }, ports(700, "2026-08-28T02:07:00.000Z")));
    expect(received.status).toBe("candidate_received");
    const reviewable = value(requireClosedPilotCandidateConfirmation(received, { expectedVersion: received.version }, ports(701)));
    const imported = value(importClosedPilotCandidate(reviewable, { expectedVersion: reviewable.version, actor: USER }, ports(702)));
    expect(imported).toMatchObject({ status: "review_required", candidate: { status: "imported", authority: "model_proposed", canMutateAuthority: false } });
    expect(imported.disposition).toBeUndefined();
    expect(bindClosedPilotDisposition(imported, { expectedVersion: imported.version, reviewId: "rrvw_00000000000000000000000010", receiptId: "rrcp_00000000000000000000000011", traceId: "rrcp_00000000000000000000000012", disposition: "accept", actor: HOST }, ports(703))).toMatchObject({ ok: false, error: { code: "user_pilot_action_required" } });
  });

  it("fences cancellation and restart-unknown attempts so late output cannot reopen or auto-retry", () => {
    const running = runningCandidatePilot();
    const attempt = running.attempts[0]!;
    const cancelled = value(cancelClosedPilotAttempt(running, { expectedVersion: running.version, attemptId: attempt.id, actor: USER }, ports(800)));
    expect(cancelled.status).toBe("cancelled");
    expect(receiveClosedPilotCandidate(cancelled, { expectedVersion: cancelled.version, attemptId: attempt.id, invocationId: attempt.invocationId!, manifestHash: attempt.manifestHash, mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: attempt.manifestHash }, candidate: { candidateMarkdown: "late", materialDelta: "late", preservedDecisionIds: [], affectedIssueIds: [], evidenceUsed: [], unknowns: [], reopenResolvedIssue: false, authority: "model_proposed", canMutateAuthority: false } }, ports(801))).toMatchObject({ ok: false, error: { code: "pilot_late_result_rejected" } });

    const recovered = value(recoverInterruptedClosedPilot(running, { expectedVersion: running.version }, ports(802, "2026-08-28T03:00:00.000Z")));
    expect(recovered).toMatchObject({ status: "interrupted_unknown", invocationBudget: { automaticRetries: 0 } });
    expect(recovered.attempts[0]?.status).toBe("unknown");
  });

  it("requires existing Review and user disposition before a fresh continuity invocation can verify state", () => {
    const running = runningCandidatePilot();
    const attempt = running.attempts[0]!;
    const received = value(receiveClosedPilotCandidate(running, { expectedVersion: running.version, attemptId: attempt.id, invocationId: attempt.invocationId!, manifestHash: attempt.manifestHash, mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: attempt.manifestHash }, candidate: { candidateMarkdown: "Association-bounded candidate.", materialDelta: "Removes causal overclaim.", preservedDecisionIds: [DECISION_ID], affectedIssueIds: [ISSUE_ID], evidenceUsed: [EVIDENCE_ID], unknowns: [], reopenResolvedIssue: false, authority: "model_proposed", canMutateAuthority: false } }, ports(900)));
    const requested = value(requireClosedPilotCandidateConfirmation(received, { expectedVersion: received.version }, ports(901)));
    const imported = value(importClosedPilotCandidate(requested, { expectedVersion: requested.version, actor: USER }, ports(902)));
    const review = value(bindClosedPilotReview(imported, { expectedVersion: imported.version, reviewId: "rrvw_00000000000000000000000010", importedRevisionId: "rrev_00000000000000000000000011", reviewMode: "ledger_only" }, ports(903)));
    expect(review.status).toBe("user_disposition_required");
    const disposed = value(bindClosedPilotDisposition(review, { expectedVersion: review.version, reviewId: review.review!.reviewId, receiptId: "rrcp_00000000000000000000000012", traceId: "rrcp_00000000000000000000000013", disposition: "accept", actor: USER }, ports(904)));
    expect(disposed.status).toBe("continuity_check_ready");

    const prepared = value(prepareClosedPilotContext(disposed, { ...contextInput("continuity_check"), expectedVersion: disposed.version }, ports(905)));
    const continuityAttempt = prepared.attempts.at(-1)!;
    const confirmed = value(confirmClosedPilotContext(prepared, { expectedVersion: prepared.version, attemptId: continuityAttempt.id, manifestId: continuityAttempt.manifestId, manifestHash: continuityAttempt.manifestHash, confirmationNonce: continuityAttempt.confirmationNonce, actor: USER }, ports(906, "2026-08-28T02:05:00.000Z")));
    const launched = value(startClosedPilotAttempt(confirmed, { expectedVersion: confirmed.version, attemptId: continuityAttempt.id, manifestHash: continuityAttempt.manifestHash }, ports(907)));
    const runningContinuity = value(markClosedPilotAttemptRunning(launched, { expectedVersion: launched.version, attemptId: continuityAttempt.id, invocationId: launched.attempts.at(-1)!.invocationId! }, ports(908)));
    const completed = value(completeClosedPilotContinuity(runningContinuity, { expectedVersion: runningContinuity.version, attemptId: continuityAttempt.id, invocationId: runningContinuity.attempts.at(-1)!.invocationId!, manifestHash: continuityAttempt.manifestHash, observation: { authority: "host_observation", canMutateAuthority: false, projectId: PROJECT_ID, briefId: BRIEF_ID, briefVersion: 2, episodeId: EPISODE_ID, episodeStatus: "accepted", decisionStates: [{ id: DECISION_ID, status: "accepted" }], issueStates: [{ id: ISSUE_ID, status: "resolved", treatAsOpenAudit: false, reopenProposed: false }], canonicalStateHash: "a".repeat(64), mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: continuityAttempt.manifestHash } } }, ports(909)));
    expect(completed.status).toBe("continuity_verified");
    expect(completed.continuity?.invocationId).not.toBe(attempt.invocationId);
    expect(value(closeClosedExternalAppPilot(completed, { expectedVersion: completed.version, actor: USER }, ports(910))).status).toBe("closed");
  });

  it("exports only bounded evidence and never research or candidate text", () => {
    const pilot = runningCandidatePilot();
    const exported = value(createClosedPilotEvidenceExport(pilot));
    const json = JSON.stringify(exported);
    expect(exported).toMatchObject({ schemaVersion: "1.0.0", evidenceClass: "synthetic_fixture", host: "codex", authorityMutationCount: 0, automaticRetryCount: 0 });
    expect(json).not.toContain("Review the causal wording");
    expect(json).not.toContain("Keep the evidence boundary");
    expect(json).not.toContain("Synthetic association evidence");
    expect(json).not.toMatch(/[A-Za-z]:\\|\/Users\//u);
  });
});
