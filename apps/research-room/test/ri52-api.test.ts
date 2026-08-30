import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSestina, type CoreResult } from "@sestina/core";
import type { ClosedCodexPilotRunResult, CodexHostInspection } from "@sestina/mcp";
import {
  createResearchRoomServer,
  type ClosedExternalAppHostRuntime,
  type RunningResearchRoomServer,
} from "../src/server.js";
import type {
  AnalyzedReviewDto,
  ClosedExternalAppPilotDto,
  ClosedPilotDispositionDto,
  ClosedPilotEvidenceDto,
  ClosedPilotImportDto,
  StatusDto,
} from "../client/src/api/dto.js";
import { createContinuityOnlyHostRuntime, Ri52FixtureHostRuntime } from "../../../tests/helpers/ri52-runtime.js";

const USER = Object.freeze({ kind: "user" as const, actorId: "ri52-api-owner" });
const roots: string[] = [];
const servers: RunningResearchRoomServer[] = [];

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

class LanguageStore {
  readLanguage() { return Promise.resolve("en" as const); }
  writeLanguage() { return Promise.resolve(); }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri52-api-")); roots.push(root);
  await mkdir(join(root, ".sestina"));
  const core = valueOf(await openSestina({ databasePath: join(root, ".sestina", "state.sqlite") }));
  const project = valueOf(core.initializeProject({ title: "RI-52 API", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({ projectId: project.id, actor: USER, kind: "research_note", relativePath: "notes/pilot.md", content: "# Safe synthetic project\n", mediaType: "text/markdown" }));
  const brief = valueOf(core.activateBrief({
    projectId: project.id, actor: USER, projectQuestion: "Can an exact read-only Codex handoff preserve user Authority?", currentStage: "revision", currentTask: "Review one bounded Codex proposal.", targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [{ statement: "External hosts remain proposal-only.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }], forbiddenChanges: [],
    expectedDeltas: [{ statement: "Add one bounded qualification.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] } }],
    evidenceBoundaries: [], explicitNonGoals: ["Automatic acceptance", "Write MCP"],
  }));
  const decision = valueOf(core.recordDecision({ projectId: project.id, actor: USER, statement: "Codex output is model_proposed only.", scope: { kind: "project" }, rationale: "Only the user has Authority.", effectiveBriefVersionId: brief.currentVersionId, reopenConditions: ["Authority contract changes."], status: "accepted" }));
  valueOf(core.startRevisionEpisode({ projectId: project.id, artifactId: artifact.artifact.id, briefVersionId: brief.currentVersionId, baselineRevisionId: artifact.revision.id, actor: USER }));
  core.close();
  await writeFile(join(root, ".sestina", "research-brief.yaml"), "schemaVersion: 1\nstatus: active\n", "utf8");
  return { root, projectId: project.id, decisionId: decision.id };
}

interface ApiBody<T> {
  readonly ok: boolean;
  readonly value: T;
  readonly error?: { readonly code: string };
}

async function api<T = unknown>(origin: string, token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-sestina-session": token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, body: await response.json() as ApiBody<T> };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RI-52 production closed external App Pilot API", () => {
  it("keeps the continuity-only host boundary to one delegated continuity invocation", async () => {
    const delegated = new Ri52FixtureHostRuntime("rdec_01J00000000000000000000000");
    delegated.delayMs = 0;
    const runtime = createContinuityOnlyHostRuntime(delegated);
    const base = {
      projectRoot: "C:\\sestina-safe-fixture",
      binding: {
        pilotId: "rplt_01J00000000000000000000000",
        attemptId: "rpat_01J00000000000000000000000",
        manifestId: "rman_01J00000000000000000000000",
        manifestHash: "a".repeat(64),
        projectId: "rprj_01J00000000000000000000000",
        briefId: "rbrf_01J00000000000000000000000",
        briefVersion: 1,
        episodeId: "repi_01J00000000000000000000000",
        decisionIds: [],
        issueIds: [],
        evidenceIds: [],
        canonicalStateHash: "b".repeat(64),
        episodeStatus: "active",
        decisionStates: [],
        issueStates: [],
      },
      contextUtf8: "{}",
      signal: new AbortController().signal,
      timeoutMs: 120_000,
      outputLimitBytes: 65_536,
    } as const;

    await expect(runtime.run({ ...base, kind: "candidate_generation" })).resolves.toMatchObject({ ok: false, error: { code: "host_protocol_mismatch" } });
    expect(runtime.invocationCount).toBe(0);
    expect(delegated.observations).toHaveLength(0);

    await expect(runtime.run({ ...base, kind: "continuity_check" })).resolves.toMatchObject({ ok: true, value: { continuity: { authority: "host_observation", canMutateAuthority: false } } });
    expect(runtime.invocationCount).toBe(1);
    expect(delegated.observations.map((item) => item.kind)).toEqual(["continuity_check"]);

    await expect(runtime.run({ ...base, kind: "continuity_check" })).resolves.toMatchObject({ ok: false, error: { code: "host_protocol_mismatch" } });
    expect(runtime.invocationCount).toBe(1);
    expect(delegated.observations).toHaveLength(1);
  });

  it("binds the exact preview bytes to one Codex attempt, existing Review, user disposition, fresh-session continuity, and a redacted evidence export", async () => {
    const data = await fixture();
    const sent: { kind: string; contextUtf8: string; manifestHash: string; invocation: number }[] = [];
    const inspection: CodexHostInspection = { availability: "available", supportedVersion: "codex-cli 0.150.0", verifiedAt: "2026-08-28T02:00:00.000Z", capabilities: { start: "observed", structuredOutput: "observed", mcp: "observed", readOnlySandbox: "observed", cancellation: "observed", contextIsolation: "observed" }, configurationSeparateFromVerification: true };
    const runtime: ClosedExternalAppHostRuntime = {
      evidenceClass: "synthetic_fixture" as const,
      inspect: () => Promise.resolve(inspection),
      run: (input): Promise<ClosedCodexPilotRunResult> => {
        sent.push({ kind: input.kind, contextUtf8: input.contextUtf8, manifestHash: input.binding.manifestHash, invocation: sent.length + 1 });
        if (input.kind === "candidate_generation") return Promise.resolve({ ok: true, value: { candidate: { candidateMarkdown: "# Safe synthetic project\n\nAdd a bounded uncertainty statement.", materialDelta: "Adds one bounded uncertainty statement.", preservedDecisionIds: [data.decisionId], affectedIssueIds: [], evidenceUsed: [], unknowns: ["External user value remains unproven."], reopenResolvedIssue: false, authority: "model_proposed", canMutateAuthority: false }, mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: input.binding.manifestHash }, stdoutBytes: 512, stderrBytes: 0, usage: "unavailable" } });
        return Promise.resolve({ ok: true, value: { continuity: { authority: "host_observation", canMutateAuthority: false, projectId: input.binding.projectId, briefId: input.binding.briefId, briefVersion: input.binding.briefVersion, episodeId: input.binding.episodeId, episodeStatus: input.binding.episodeStatus ?? "unknown", decisionStates: input.binding.decisionStates ?? [], issueStates: (input.binding.issueStates ?? []).map((item) => ({ ...item, treatAsOpenAudit: false, reopenProposed: false })), canonicalStateHash: input.binding.canonicalStateHash ?? "" }, mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: input.binding.manifestHash }, stdoutBytes: 384, stderrBytes: 0, usage: "unavailable" } });
      },
    };
    const server = await createResearchRoomServer({ languagePreferenceStore: new LanguageStore(), closedExternalAppHostRuntime: runtime }).start(); servers.push(server);
    const status = (await (await fetch(`${server.origin}/api/status`)).json() as ApiBody<StatusDto>).value;
    expect((await api(server.origin, status.sessionToken, "POST", "/api/project/open", { projectPath: data.root })).response.status).toBe(200);
    expect((await api<CodexHostInspection>(server.origin, status.sessionToken, "GET", "/api/codex-host")).body.value).toEqual(inspection);

    let pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", "/api/project/external-app-pilots", { confirmed: true })).body.value;
    expect(pilot).toMatchObject({ projectId: data.projectId, host: "codex", authority: "external_host_proposal_only", canMutateAuthority: false, status: "preflight_ready" });
    pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/context`, { expectedVersion: pilot.version, kind: "candidate_generation", selectedMemoryItemIds: [], externalModelServiceMayBeCalled: true, timeoutMs: 120_000, outputLimitBytes: 65_536 })).body.value;
    const manifest = pilot.manifests[0]; const attempt = pilot.attempts[0];
    expect(manifest.workingMemorySelection).toEqual({ defaultSelectedCount: 0, selectedIds: [], neverSendIncludedCount: 0 });
    const blocked = await api(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/launch`, { expectedVersion: pilot.version, attemptId: attempt.id, manifestHash: manifest.payloadHash, confirmed: true });
    expect(blocked.response.status).toBe(400);
    expect(blocked.body.error?.code).toBe("user_confirmation_required");
    pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/confirm`, { expectedVersion: pilot.version, attemptId: attempt.id, manifestId: manifest.id, manifestHash: manifest.payloadHash, confirmationNonce: attempt.confirmationNonce, confirmed: true })).body.value;
    pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/launch`, { expectedVersion: pilot.version, attemptId: attempt.id, manifestHash: manifest.payloadHash, confirmed: true })).body.value;
    expect(pilot.status).toBe("candidate_confirmation_required");
    expect(sent[0]).toMatchObject({ kind: "candidate_generation", contextUtf8: manifest.payloadUtf8, manifestHash: manifest.payloadHash, invocation: 1 });
    expect(Buffer.byteLength(sent[0]?.contextUtf8 ?? "", "utf8")).toBe(manifest.payloadBytes);

    const imported = (await api<ClosedPilotImportDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/candidate/import`, { expectedVersion: pilot.version, confirmed: true })).body.value;
    pilot = imported.pilot;
    expect(imported).toMatchObject({ pilot: { status: "user_disposition_required", candidate: { status: "imported", authority: "model_proposed", canMutateAuthority: false } }, review: { providerStatus: "ledger_only" } });
    const analyzed = (await api<AnalyzedReviewDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/review/analyze`, { reviewId: imported.review.reviewId, confirmationNonce: imported.review.confirmationNonce, manifestHash: imported.review.manifestHash, confirmed: true })).body.value;
    const disposed = (await api<ClosedPilotDispositionDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/disposition`, { expectedVersion: pilot.version, reviewId: analyzed.reviewId, authorityNonce: analyzed.authorityNonce, expectedStateBinding: analyzed.stateBinding, disposition: "deferred", reason: "Owner defers this model proposal after Review.", confirmed: true })).body.value;
    pilot = disposed.pilot;
    expect(disposed).toMatchObject({ pilot: { status: "continuity_check_ready", disposition: { decidedBy: "user" } }, receipt: { providerStatus: "ledger_only", authority: { actor: { kind: "user" } } } });

    pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/context`, { expectedVersion: pilot.version, kind: "continuity_check", selectedMemoryItemIds: [], externalModelServiceMayBeCalled: true, timeoutMs: 120_000, outputLimitBytes: 65_536 })).body.value;
    const continuityManifest = pilot.manifests[1]; const continuityAttempt = pilot.attempts[1];
    pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/confirm`, { expectedVersion: pilot.version, attemptId: continuityAttempt.id, manifestId: continuityManifest.id, manifestHash: continuityManifest.payloadHash, confirmationNonce: continuityAttempt.confirmationNonce, confirmed: true })).body.value;
    pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/launch`, { expectedVersion: pilot.version, attemptId: continuityAttempt.id, manifestHash: continuityManifest.payloadHash, confirmed: true })).body.value;
    expect(pilot).toMatchObject({ status: "continuity_verified", continuity: { authority: "host_observation", canMutateAuthority: false } });
    expect(sent[1]).toMatchObject({ kind: "continuity_check", contextUtf8: continuityManifest.payloadUtf8, manifestHash: continuityManifest.payloadHash, invocation: 2 });
    expect(sent[1]?.contextUtf8).not.toContain("Add a bounded uncertainty statement.");

    pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/feedback`, { expectedVersion: pilot.version, codes: ["useful"], note: "Bounded local fixture.", confirmed: true })).body.value;
    pilot = (await api<ClosedExternalAppPilotDto>(server.origin, status.sessionToken, "POST", `/api/project/external-app-pilots/${pilot.id}/close`, { expectedVersion: pilot.version, confirmed: true })).body.value;
    expect(pilot.status).toBe("closed");
    const evidence = (await api<ClosedPilotEvidenceDto>(server.origin, status.sessionToken, "GET", `/api/project/external-app-pilots/${pilot.id}/evidence`)).body.value;
    expect(evidence).toMatchObject({ evidenceClass: "synthetic_fixture", stableOutcome: "closed", stages: { continuityVerified: true, closed: true }, authorityMutationCount: 0, automaticRetryCount: 0, externalUserEvidenceCount: 0 });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("Safe synthetic project");
    expect(serialized).not.toContain(data.root);
  });
});
