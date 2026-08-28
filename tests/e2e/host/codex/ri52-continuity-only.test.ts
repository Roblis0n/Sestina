import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openSestina, type CoreResult } from "../../../../packages/core/src/index.js";
import { CAPABILITY_POLICY, defaultCodexLaunchTargetLocator } from "../../../../integrations/mcp/src/index.js";
import { ResearchRoomApi } from "../../../../apps/research-room/client/src/api/client.js";
import {
  createProductionClosedExternalAppHostRuntime,
  createResearchRoomServer,
  type RunningResearchRoomServer,
} from "../../../../apps/research-room/src/server.js";
import { createContinuityOnlyHostRuntime, Ri52FixtureHostRuntime } from "../../../helpers/ri52-runtime.js";

const USER = Object.freeze({ kind: "user" as const, actorId: "ri52-continuity-only-owner-fixture" });
const REAL_CONTINUITY_AUTHORIZED = process.env.SESTINA_RI52_REAL_CODEX_CONTINUITY === "authorized_once";
const roots: string[] = [];
const nativeFetch = globalThis.fetch;
let activeServer: RunningResearchRoomServer | undefined;

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
}

async function closeActiveServer(): Promise<void> {
  globalThis.fetch = nativeFetch;
  const server = activeServer;
  activeServer = undefined;
  await server?.close();
}

class EnglishLanguageStore {
  readLanguage() { return Promise.resolve("en" as const); }
  writeLanguage() { return Promise.resolve(undefined); }
}

async function createSafeSyntheticProject() {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri52-continuity-only-"));
  roots.push(root);
  await mkdir(join(root, ".sestina"));
  const core = valueOf(await openSestina({ databasePath: join(root, ".sestina", "state.sqlite") }));
  const project = valueOf(core.initializeProject({ title: "RI-52 continuity-only fixture", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({
    projectId: project.id,
    actor: USER,
    kind: "research_note",
    relativePath: "notes/continuity-only-fixture.md",
    content: "# Safe synthetic continuity fixture\n\nExternal host output remains proposal-only.\n",
    mediaType: "text/markdown",
  }));
  const brief = valueOf(core.activateBrief({
    projectId: project.id,
    actor: USER,
    projectQuestion: "Can a new read-only host session recover the exact canonical state after user disposition?",
    currentStage: "revision",
    currentTask: "Observe continuity without changing user Authority.",
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

async function createIsolatedDecoyProject(): Promise<{ readonly projectId: string }> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri52-continuity-decoy-"));
  roots.push(root);
  await mkdir(join(root, ".sestina"));
  const core = valueOf(await openSestina({ databasePath: join(root, ".sestina", "state.sqlite") }));
  try {
    const project = valueOf(core.initializeProject({ title: "RI-52 isolated decoy project", actor: USER }));
    return { projectId: project.id };
  } finally {
    core.close();
  }
}

function safeObservation(pilot: Awaited<ReturnType<ResearchRoomApi["getClosedExternalAppPilot"]>>, manifestHash: string, invocationCount: number) {
  const attempt = pilot.attempts.find((item) => item.kind === "continuity_check");
  return Object.freeze({
    mode: REAL_CONTINUITY_AUTHORIZED ? "real_codex_continuity" : "synthetic_harness_preflight",
    status: pilot.status,
    failureCode: pilot.failure?.code ?? null,
    attemptId: attempt?.id ?? null,
    invocationId: attempt?.invocationId ?? null,
    attemptStatus: attempt?.status ?? null,
    manifestHash,
    mcpHealth: attempt?.mcpObservation?.health ?? null,
    mcpGetResearchContext: attempt?.mcpObservation?.getResearchContext ?? null,
    observedPayloadHash: attempt?.mcpObservation?.payloadHash ?? null,
    delegatedContinuityInvocations: invocationCount,
  });
}

afterEach(closeActiveServer);
afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.sequential("RI-52 continuity-only fresh host boundary", () => {
  it("prepares post-disposition state synthetically, restarts the service, and delegates only one continuity attempt", async () => {
    const data = await createSafeSyntheticProject();
    const decoy = await createIsolatedDecoyProject();
    const syntheticCandidateRuntime = new Ri52FixtureHostRuntime(data.decisionId);
    syntheticCandidateRuntime.delayMs = 0;

    activeServer = await createResearchRoomServer({
      languagePreferenceStore: new EnglishLanguageStore(),
      closedExternalAppHostRuntime: syntheticCandidateRuntime,
    }).start();
    bindRelativeFetch(activeServer.origin);
    const setupApi = new ResearchRoomApi();
    const firstStatus = await setupApi.status();
    await setupApi.openProject(data.root, false);

    let pilot = await setupApi.createClosedExternalAppPilot();
    expect(pilot).toMatchObject({ evidenceClass: "synthetic_fixture", projectId: data.projectId, status: "preflight_ready", canMutateAuthority: false });
    pilot = await setupApi.prepareClosedExternalAppPilotContext(pilot, "candidate_generation", []);
    pilot = await setupApi.confirmClosedExternalAppPilotContext(pilot);
    pilot = await setupApi.launchClosedExternalAppPilot(pilot);
    expect(pilot.status).toBe("candidate_confirmation_required");
    expect(syntheticCandidateRuntime.observations.map((item) => item.kind)).toEqual(["candidate_generation"]);
    const candidateInvocationId = required(pilot.attempts[0]?.invocationId, "synthetic candidate invocation identity");
    const candidateMarkdown = required(pilot.candidate, "synthetic candidate").candidateMarkdown;

    const imported = await setupApi.importClosedExternalAppPilotCandidate(pilot);
    pilot = imported.pilot;
    const analyzed = await setupApi.analyzeClosedExternalAppPilotReview(pilot, imported.review);
    expect(analyzed.providerStatus).toBe("ledger_only");
    const disposed = await setupApi.commitClosedExternalAppPilotDisposition(
      pilot,
      analyzed,
      "deferred",
      "The synthetic setup owner defers this proposal after deterministic Review.",
    );
    pilot = disposed.pilot;
    const disposition = required(pilot.disposition, "user disposition binding");
    expect(pilot).toMatchObject({
      evidenceClass: "synthetic_fixture",
      status: "continuity_check_ready",
      candidate: { status: "imported", authority: "model_proposed", canMutateAuthority: false },
      disposition: { disposition: "defer", decidedBy: "user", receiptId: disposed.receipt.id },
    });
    expect(await setupApi.researchObject("receipt", disposition.receiptId)).toMatchObject({ id: disposition.receiptId });

    await closeActiveServer();
    expect((await stat(join(data.root, ".sestina", "state.sqlite"))).isFile()).toBe(true);

    const productionRuntime = REAL_CONTINUITY_AUTHORIZED
      ? createProductionClosedExternalAppHostRuntime()
      : new Ri52FixtureHostRuntime(data.decisionId);
    if (!REAL_CONTINUITY_AUTHORIZED && productionRuntime instanceof Ri52FixtureHostRuntime) productionRuntime.delayMs = 0;
    const continuityRuntime = createContinuityOnlyHostRuntime(productionRuntime);

    if (REAL_CONTINUITY_AUTHORIZED) {
      const launchTarget = await defaultCodexLaunchTargetLocator();
      expect(launchTarget.ok).toBe(true);
      if (!launchTarget.ok) throw new Error("The official Codex launch target is unavailable before the one authorized continuity invocation.");
      expect(isAbsolute(launchTarget.value.executable)).toBe(true);
      expect((await stat(launchTarget.value.executable)).isFile()).toBe(true);
      const mcpRuntime = join(process.cwd(), "apps", "research-room", "dist", "mcp", "main.js");
      expect(isAbsolute(mcpRuntime)).toBe(true);
      expect((await stat(mcpRuntime)).isFile()).toBe(true);
    }

    activeServer = await createResearchRoomServer({
      languagePreferenceStore: new EnglishLanguageStore(),
      closedExternalAppHostRuntime: continuityRuntime,
    }).start();
    bindRelativeFetch(activeServer.origin);
    const continuityApi = new ResearchRoomApi();
    const secondStatus = await continuityApi.status();
    expect(secondStatus.sessionToken).not.toBe(firstStatus.sessionToken);
    await continuityApi.openProject(data.root, false);

    pilot = await continuityApi.getClosedExternalAppPilot(pilot.id);
    expect(pilot).toMatchObject({
      evidenceClass: "synthetic_fixture",
      projectId: data.projectId,
      status: "continuity_check_ready",
      candidate: { status: "imported", authority: "model_proposed", canMutateAuthority: false },
      disposition: { reviewId: disposition.reviewId, receiptId: disposition.receiptId, traceId: disposition.traceId, disposition: "defer", decidedBy: "user" },
    });
    expect(await continuityApi.researchObject("receipt", disposition.receiptId)).toMatchObject({ id: disposition.receiptId });

    pilot = await continuityApi.prepareClosedExternalAppPilotContext(pilot, "continuity_check", []);
    const continuityManifest = required(pilot.manifests.find((item) => item.purpose === "continuity_check"), "continuity Manifest");
    const continuityAttempt = required(pilot.attempts.find((item) => item.kind === "continuity_check"), "continuity attempt");
    const payload = continuityManifest.payload as {
      readonly manifestBinding?: { readonly projectId?: string; readonly purpose?: string };
      readonly projectStateHash?: string;
      readonly brief?: { readonly id?: string; readonly version?: number };
      readonly episode?: { readonly id?: string; readonly status?: string };
      readonly decisions?: readonly { readonly id?: string; readonly status?: string }[];
      readonly workingMemory?: readonly unknown[];
    };
    expect(continuityAttempt).toMatchObject({ ordinal: 1, status: "prepared", manifestHash: continuityManifest.payloadHash });
    expect(Buffer.byteLength(continuityManifest.payloadUtf8, "utf8")).toBe(continuityManifest.payloadBytes);
    expect(createHash("sha256").update(continuityManifest.payloadUtf8, "utf8").digest("hex")).toBe(continuityManifest.payloadHash);
    expect(payload).toMatchObject({
      manifestBinding: { projectId: data.projectId, purpose: "continuity_check" },
      episode: { id: data.episodeId, status: "active" },
      workingMemory: [],
    });
    expect(payload.decisions).toContainEqual(expect.objectContaining({ id: data.decisionId, status: "accepted" }));
    expect(continuityManifest.workingMemorySelection).toEqual({ defaultSelectedCount: 0, selectedIds: [], neverSendIncludedCount: 0 });
    expect(continuityManifest.disclosure).toMatchObject({ invocationLimit: 1, automaticRetries: 0, sandbox: "read_only", projectWrite: false });
    expect(continuityManifest.payloadUtf8).not.toContain(candidateMarkdown);
    expect(continuityManifest.payloadUtf8).not.toContain("candidateMarkdown");
    expect(continuityManifest.payloadUtf8).not.toContain(data.root);
    expect(continuityManifest.payloadUtf8).not.toContain(decoy.projectId);
    expect(CAPABILITY_POLICY).toEqual({
      tools: ["health", "get_research_context"],
      resources: ["sestina://research/current-brief"],
      prompts: [],
      resourceTemplates: [],
      write: false,
      network: false,
      daemon: false,
    });

    pilot = await continuityApi.confirmClosedExternalAppPilotContext(pilot);
    expect(pilot.status).toBe("context_confirmed");
    expect(continuityRuntime.invocationCount).toBe(0);
    console.info(`RI52_CONTINUITY_PREFLIGHT ${JSON.stringify({
      mode: REAL_CONTINUITY_AUTHORIZED ? "real_codex_continuity" : "synthetic_harness_preflight",
      setupEvidenceClass: "synthetic_fixture",
      projectId: data.projectId,
      pilotId: pilot.id,
      attemptId: continuityAttempt.id,
      manifestId: continuityManifest.id,
      manifestHash: continuityManifest.payloadHash,
      payloadBytes: continuityManifest.payloadBytes,
      priorServiceClosed: true,
      serviceSessionChanged: true,
      candidateBodyExcluded: true,
      publicMcpWriteCapability: false,
      automaticRetries: 0,
      delegatedContinuityInvocations: 0,
    })}`);

    try {
      pilot = await continuityApi.launchClosedExternalAppPilot(pilot);
    } catch (error) {
      const recovered = await continuityApi.getClosedExternalAppPilot(pilot.id).catch(() => pilot);
      console.info(`RI52_CONTINUITY_OBSERVATION ${JSON.stringify(safeObservation(recovered, continuityManifest.payloadHash, continuityRuntime.invocationCount))}`);
      throw error;
    }
    const observation = safeObservation(pilot, continuityManifest.payloadHash, continuityRuntime.invocationCount);
    console.info(`RI52_CONTINUITY_OBSERVATION ${JSON.stringify(observation)}`);
    expect(continuityRuntime.invocationCount).toBe(1);
    if (pilot.status !== "continuity_verified") {
      throw new Error(`Continuity-only attempt stopped: ${pilot.failure?.code ?? pilot.status} · ${pilot.failure?.publicReason ?? "no public reason"}`);
    }

    const completedAttempt = required(pilot.attempts.find((item) => item.kind === "continuity_check"), "completed continuity attempt");
    expect(completedAttempt).toMatchObject({
      id: continuityAttempt.id,
      status: "completed",
      mcpObservation: { health: "completed", getResearchContext: "completed", payloadHash: continuityManifest.payloadHash },
      usage: "unavailable",
    });
    expect(completedAttempt.invocationId).toBeDefined();
    expect(completedAttempt.invocationId).not.toBe(candidateInvocationId);
    expect(pilot).toMatchObject({
      status: "continuity_verified",
      projectId: data.projectId,
      authority: "external_host_proposal_only",
      canMutateAuthority: false,
      disposition: { receiptId: disposition.receiptId, traceId: disposition.traceId, decidedBy: "user" },
      continuity: {
        authority: "host_observation",
        canMutateAuthority: false,
        projectId: data.projectId,
        episodeId: data.episodeId,
        canonicalStateHash: payload.projectStateHash,
      },
    });
    expect(pilot.attempts.filter((item) => item.kind === "continuity_check")).toHaveLength(1);
    expect(await continuityApi.researchObject("receipt", disposition.receiptId)).toMatchObject({ id: disposition.receiptId });

    pilot = await continuityApi.recordClosedExternalAppPilotFeedback(pilot, ["useful"], "Safe owner-operated continuity observation; synthetic setup is not candidate evidence.");
    pilot = await continuityApi.closeClosedExternalAppPilot(pilot);
    const evidence = await continuityApi.closedExternalAppPilotEvidence(pilot.id);
    expect(pilot.status).toBe("closed");
    expect(evidence).toMatchObject({
      evidenceClass: "synthetic_fixture",
      stableOutcome: "closed",
      stages: { candidateReceived: true, candidateImported: true, reviewBound: true, dispositionRecorded: true, continuityVerified: true, closed: true },
      authorityMutationCount: 0,
      automaticRetryCount: 0,
      externalUserEvidenceCount: 0,
    });
    const serializedEvidence = JSON.stringify(evidence);
    expect(serializedEvidence).not.toContain(candidateMarkdown);
    expect(serializedEvidence).not.toContain(data.root);
    console.info(`RI52_CONTINUITY_FINAL ${JSON.stringify({
      ...observation,
      finalPilotStatus: pilot.status,
      evidenceClass: evidence.evidenceClass,
      authorityMutationCount: evidence.authorityMutationCount,
      automaticRetryCount: evidence.automaticRetryCount,
      externalUserEvidenceCount: evidence.externalUserEvidenceCount,
      priorRealCandidateEvidenceRequiredForClosure: true,
    })}`);
  }, 420_000);
});
