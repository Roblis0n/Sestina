import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openSestina, type CoreResult } from "../../../../packages/core/src/index.js";
import { ResearchRoomApi } from "../../../../apps/research-room/client/src/api/client.js";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../../../apps/research-room/src/server.js";

const USER = Object.freeze({ kind: "user" as const, actorId: "ri52-real-codex-owner-fixture" });
const roots: string[] = [];
const servers: RunningResearchRoomServer[] = [];
const nativeFetch = globalThis.fetch;
let restoreFetch: (() => void) | undefined;
let realPilotState: {
  readonly root: string;
  readonly projectId: string;
  readonly episodeId: string;
  readonly pilotId: string;
  readonly candidateInvocationId: string;
  readonly candidateMarkdown: string;
} | undefined;

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function bindRelativeFetch(origin: string): void {
  globalThis.fetch = async (input, init) => {
    const target = typeof input === "string" ? new URL(input, origin) : input;
    return await nativeFetch(target, init);
  };
  restoreFetch = () => { globalThis.fetch = nativeFetch; };
}

class EnglishLanguageStore {
  readLanguage() { return Promise.resolve("en" as const); }
  writeLanguage() { return Promise.resolve(undefined); }
}

async function createSafeSyntheticProject() {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri52-real-codex-"));
  roots.push(root);
  await mkdir(join(root, ".sestina"));
  const core = valueOf(await openSestina({ databasePath: join(root, ".sestina", "state.sqlite") }));
  const project = valueOf(core.initializeProject({ title: "RI-52 bounded host fixture", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({
    projectId: project.id,
    actor: USER,
    kind: "research_note",
    relativePath: "notes/bounded-host-fixture.md",
    content: "# Safe synthetic research note\n\nThe external host is proposal-only.\n",
    mediaType: "text/markdown",
  }));
  const brief = valueOf(core.activateBrief({
    projectId: project.id,
    actor: USER,
    projectQuestion: "Can a frozen read-only host handoff preserve user Authority?",
    currentStage: "revision",
    currentTask: "Propose one bounded uncertainty statement without changing Authority.",
    targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [{
      statement: "External host output remains model_proposed until the user acts.",
      scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] },
    }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [],
    expectedDeltas: [{
      statement: "Add one explicit uncertainty boundary.",
      scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] },
    }],
    evidenceBoundaries: [],
    explicitNonGoals: ["Automatic acceptance", "Write MCP", "External user evidence"],
  }));
  const decision = valueOf(core.recordDecision({
    projectId: project.id,
    actor: USER,
    statement: "Codex output is model_proposed only.",
    scope: { kind: "project" },
    rationale: "The local user remains the only research authority.",
    effectiveBriefVersionId: brief.currentVersionId,
    reopenConditions: ["The Authority contract changes."],
    status: "accepted",
  }));
  const episode = valueOf(core.startRevisionEpisode({
    projectId: project.id,
    artifactId: artifact.artifact.id,
    briefVersionId: brief.currentVersionId,
    baselineRevisionId: artifact.revision.id,
    actor: USER,
  }));
  core.close();
  await writeFile(join(root, ".sestina", "research-brief.yaml"), "schemaVersion: 1\nstatus: active\n", "utf8");
  return { root, projectId: project.id, episodeId: episode.id, decisionId: decision.id };
}

afterEach(async () => {
  restoreFetch?.();
  restoreFetch = undefined;
  while (servers.length > 0) await servers.pop()?.close();
});

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.sequential("RI-52 owner-operated real Codex closed host Pilot", () => {
  it("observes exact frozen MCP context and carries one real proposal-only candidate through existing Review and user disposition", async () => {
    const data = await createSafeSyntheticProject();
    const server = await createResearchRoomServer({ languagePreferenceStore: new EnglishLanguageStore() }).start();
    servers.push(server);
    bindRelativeFetch(server.origin);
    const api = new ResearchRoomApi();
    await api.status();
    await api.openProject(data.root, false);

    await expect(api.codexHost()).resolves.toMatchObject({ availability: "available", configurationSeparateFromVerification: true });

    let pilot = await api.createClosedExternalAppPilot();
    expect(pilot).toMatchObject({
      evidenceClass: "owner_operated_closed_host_observation",
      projectId: data.projectId,
      host: "codex",
      authority: "external_host_proposal_only",
      canMutateAuthority: false,
      status: "preflight_ready",
    });

    pilot = await api.prepareClosedExternalAppPilotContext(pilot, "candidate_generation", []);
    const candidateManifest = required(pilot.manifests[0], "candidate Manifest");
    required(pilot.attempts[0], "candidate attempt");
    expect(candidateManifest.workingMemorySelection).toEqual({ defaultSelectedCount: 0, selectedIds: [], neverSendIncludedCount: 0 });
    expect(Buffer.byteLength(candidateManifest.payloadUtf8, "utf8")).toBe(candidateManifest.payloadBytes);
    pilot = await api.confirmClosedExternalAppPilotContext(pilot);
    pilot = await api.launchClosedExternalAppPilot(pilot);
    if (pilot.status !== "candidate_confirmation_required") {
      throw new Error(`Real Codex candidate attempt stopped: ${pilot.failure?.code ?? pilot.status} · ${pilot.failure?.publicReason ?? "no public reason"}`);
    }
    expect(pilot).toMatchObject({
      status: "candidate_confirmation_required",
      candidate: {
        authority: "model_proposed",
        canMutateAuthority: false,
      },
    });
    expect(required(pilot.candidate, "candidate").preservedDecisionIds).toContain(data.decisionId);
    expect(pilot.attempts[0]).toMatchObject({
      status: "completed",
      mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: candidateManifest.payloadHash },
      usage: "unavailable",
    });
    const candidateInvocationId = required(pilot.attempts[0]?.invocationId, "candidate invocation identity");

    const imported = await api.importClosedExternalAppPilotCandidate(pilot);
    pilot = imported.pilot;
    expect(imported).toMatchObject({
      pilot: { status: "user_disposition_required", candidate: { status: "imported", authority: "model_proposed", canMutateAuthority: false } },
      review: { manifest: { networkRequired: false, networkUsed: false, sendStatus: "not_sent" } },
    });
    const analyzed = await api.analyzeClosedExternalAppPilotReview(pilot, imported.review);
    expect(analyzed.providerStatus).toBe("ledger_only");
    const disposed = await api.commitClosedExternalAppPilotDisposition(
      pilot,
      analyzed,
      "deferred",
      "The synthetic test owner defers the model proposal after deterministic Review.",
    );
    pilot = disposed.pilot;
    realPilotState = {
      root: data.root,
      projectId: data.projectId,
      episodeId: data.episodeId,
      pilotId: pilot.id,
      candidateInvocationId,
      candidateMarkdown: required(pilot.candidate, "candidate").candidateMarkdown,
    };
    expect(disposed).toMatchObject({
      pilot: { status: "continuity_check_ready", disposition: { decidedBy: "user", disposition: "defer" } },
      receipt: { providerStatus: "ledger_only", disposition: { kind: "deferred" } },
    });
    expect(pilot.disposition).toMatchObject({ decidedBy: "user", receiptId: disposed.receipt.id });
  }, 420_000);

  it("reopens the same canonical Pilot and verifies it from a completely fresh real Codex session", async () => {
    const state = required(realPilotState, "persisted real candidate phase");
    const server = await createResearchRoomServer({ languagePreferenceStore: new EnglishLanguageStore() }).start();
    servers.push(server);
    bindRelativeFetch(server.origin);
    const api = new ResearchRoomApi();
    await api.status();
    await api.openProject(state.root, false);
    let pilot = await api.getClosedExternalAppPilot(state.pilotId);
    expect(pilot).toMatchObject({
      projectId: state.projectId,
      status: "continuity_check_ready",
      candidate: { status: "imported", authority: "model_proposed", canMutateAuthority: false },
      disposition: { decidedBy: "user", disposition: "defer" },
    });
    pilot = await api.prepareClosedExternalAppPilotContext(pilot, "continuity_check", []);
    const continuityManifest = required(pilot.manifests[1], "continuity Manifest");
    required(pilot.attempts[1], "continuity attempt");
    expect(Buffer.byteLength(continuityManifest.payloadUtf8, "utf8")).toBe(continuityManifest.payloadBytes);
    expect(continuityManifest.payloadUtf8).not.toContain(state.candidateMarkdown);
    pilot = await api.confirmClosedExternalAppPilotContext(pilot);
    pilot = await api.launchClosedExternalAppPilot(pilot);
    if (pilot.status !== "continuity_verified") {
      throw new Error(`Real Codex continuity attempt stopped: ${pilot.failure?.code ?? pilot.status} · ${pilot.failure?.publicReason ?? "no public reason"}`);
    }
    expect(pilot).toMatchObject({
      status: "continuity_verified",
      continuity: {
        authority: "host_observation",
        canMutateAuthority: false,
        projectId: state.projectId,
        episodeId: state.episodeId,
      },
    });
    expect(pilot.attempts[1]).toMatchObject({
      status: "completed",
      mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: continuityManifest.payloadHash },
    });
    expect(pilot.attempts[1]?.invocationId).not.toBe(state.candidateInvocationId);

    pilot = await api.recordClosedExternalAppPilotFeedback(pilot, ["useful"], "Owner-operated safe synthetic host verification only.");
    pilot = await api.closeClosedExternalAppPilot(pilot);
    expect(pilot.status).toBe("closed");
    const evidence = await api.closedExternalAppPilotEvidence(pilot.id);
    expect(evidence).toMatchObject({
      evidenceClass: "owner_operated_closed_host_observation",
      stableOutcome: "closed",
      stages: { contextConfirmed: true, candidateReceived: true, candidateImported: true, reviewCompleted: true, dispositionRecorded: true, continuityVerified: true, closed: true },
      authorityMutationCount: 0,
      automaticRetryCount: 0,
      externalUserEvidenceCount: 0,
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("Safe synthetic research note");
    expect(serialized).not.toContain(state.root);
    expect(serialized).not.toContain(state.candidateMarkdown);
  }, 420_000);
});
