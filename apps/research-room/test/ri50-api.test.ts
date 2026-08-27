import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../src/language-preferences.js";
import {
  createRi50FixtureProject,
  createRi50ParticipantPair,
  type Ri50FixtureProject,
  type Ri50ProviderMode,
} from "./ri50-test-fixture.js";

class LanguageStore implements LanguagePreferenceStore {
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve("en"); }
  writeLanguage(): Promise<void> { return Promise.resolve(); }
}

interface ApiEnvelope<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

interface ManifestValue {
  readonly participantSlot: "a" | "b";
  readonly canonicalHash: string;
  readonly requestHash: string;
  readonly stateBindingHash: string;
  readonly includedObjects: readonly { readonly kind: string }[];
  readonly excludedFields: readonly string[];
}

interface RoomValue {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly title: string;
  readonly providerReadiness: string;
  readonly providerCallCount: number;
  readonly providerCallLimit: 4;
  readonly participantStates: readonly { readonly slot: "a" | "b"; readonly status: string }[];
  readonly manifests?: readonly ManifestValue[];
  readonly assessments: readonly { readonly status: string; readonly sealed: boolean; readonly assessment?: unknown }[];
  readonly differenceSummary?: {
    readonly authority: string;
    readonly canResolveRoom: boolean;
    readonly categories: readonly { readonly kind: string; readonly status: string }[];
    readonly winner: null;
    readonly ranking: null;
    readonly score: null;
  };
  readonly challenge?: { readonly id: string; readonly status: string; readonly userConfirmed: boolean };
  readonly manualExternalOpinions: readonly {
    readonly classification: string;
    readonly verification: string;
    readonly blindnessVerification: string;
    readonly exposure: { readonly sawParticipantAOutput: boolean; readonly sawParticipantBOutput: boolean };
  }[];
  readonly resolutions: readonly {
    readonly kind: string;
    readonly receipt: { readonly canonicalMutationAuthorized: boolean; readonly separateAuthorityRequired: boolean };
  }[];
  readonly trace: readonly { readonly step: string }[];
  readonly userAuthorityOnly: true;
  readonly canAutoResolve: false;
}

interface PreparedValue {
  readonly schemaVersion: "1.0.0";
  readonly contextManifestsVisible: true;
  readonly sharedContextOnly?: true;
  readonly room: RoomValue;
  readonly manifests: readonly [ManifestValue, ManifestValue];
  readonly providerPreviews: readonly [
    { readonly retryCount: 0; readonly redirectPolicy: "error"; readonly requestBodyBytes: number },
    { readonly retryCount: 0; readonly redirectPolicy: "error"; readonly requestBodyBytes: number },
  ];
}

const roots: string[] = [];
const servers: RunningResearchRoomServer[] = [];

function requireValue<T>(envelope: ApiEnvelope<T>): T {
  if (!envelope.ok || envelope.value === undefined) throw new Error(envelope.error?.code ?? "missing_api_value");
  return envelope.value;
}

async function post<T>(origin: string, token: string, path: string, body: unknown): Promise<{ readonly response: Response; readonly body: ApiEnvelope<T> }> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sestina-session": token },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as ApiEnvelope<T> };
}

async function openFixture(options: { readonly modeA?: Ri50ProviderMode; readonly modeB?: Ri50ProviderMode; readonly delayA?: number; readonly delayB?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri50-api-"));
  roots.push(root);
  const fixture = await createRi50FixtureProject(root);
  const pair = createRi50ParticipantPair(options);
  const server = await createResearchRoomServer({
    languagePreferenceStore: new LanguageStore(),
    deliberationParticipantProviders: pair.providers,
  }).start();
  servers.push(server);
  const status = await (await fetch(`${server.origin}/api/status`)).json() as { readonly value: { readonly sessionToken: string } };
  const token = status.value.sessionToken;
  const opened = await fetch(`${server.origin}/api/project/open`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sestina-session": token },
    body: JSON.stringify({ projectPath: root }),
  });
  expect(opened.status).toBe(200);
  return { root, fixture, pair, server, token };
}

function createBody(fixture: Ri50FixtureProject, commandId = "ri50-create-room-0001") {
  return {
    commandType: "create_deliberation_room",
    commandId,
    confirmed: true,
    projectId: fixture.projectId,
    sourceKind: "research_issue",
    sourceObjectId: fixture.issueId,
    question: "Does the frozen evidence justify reporting a bounded association without implying causality?",
    title: "Bounded interpretation deliberation",
  };
}

async function createAndPrepare(origin: string, token: string, fixture: Ri50FixtureProject, commandSuffix: string) {
  const created = await post<RoomValue>(origin, token, "/api/project/deliberation-rooms", createBody(fixture, `ri50-create-${commandSuffix}`));
  const room = requireValue(created.body);
  const prepared = await post<PreparedValue>(origin, token, `/api/project/deliberation-rooms/${room.id}/prepare`, {
    commandType: "prepare_deliberation_manifests",
    commandId: `ri50-prepare-${commandSuffix}`,
    confirmed: true,
    projectId: fixture.projectId,
    expectedVersion: room.version,
    revisionId: fixture.revisionId,
    allowedContext: { includeBrief: true, decisionIds: [], issueIds: [fixture.issueId], evidenceIds: [] },
  });
  return { created: room, prepared: requireValue(prepared.body) };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("RI-50 production API boundary", () => {
  it("keeps both first answers sealed, enforces exact Context Manifests, caps the directed challenge at four calls, and leaves Resolution to the user", async () => {
    const { fixture, pair, root, server, token } = await openFixture({ delayA: 25, delayB: 25 });
    const body = createBody(fixture);

    const wrongProject = await post<unknown>(server.origin, token, "/api/project/deliberation-rooms", { ...body, projectId: "rprj_01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(wrongProject.response.status).toBe(409);
    expect(wrongProject.body.error?.code).toBe("cross_project_reference");
    const unconfirmed = await post<unknown>(server.origin, token, "/api/project/deliberation-rooms", { ...body, confirmed: false });
    expect(unconfirmed.response.status).toBe(400);
    expect(unconfirmed.body.error?.code).toBe("user_confirmation_required");

    const created = await post<RoomValue>(server.origin, token, "/api/project/deliberation-rooms", body);
    const room = requireValue(created.body);
    expect(room).toMatchObject({ status: "draft", providerReadiness: "configured_distinct", providerCallCount: 0, providerCallLimit: 4, userAuthorityOnly: true, canAutoResolve: false });
    const replayedCreate = requireValue((await post<RoomValue>(server.origin, token, "/api/project/deliberation-rooms", body)).body);
    expect(replayedCreate.id).toBe(room.id);
    const conflictingCreate = await post<unknown>(server.origin, token, "/api/project/deliberation-rooms", { ...body, question: "A conflicting reuse must not create another room." });
    expect(conflictingCreate.response.status).toBe(409);
    expect(conflictingCreate.body.error?.code).toBe("state_conflict");

    const expandedContext = await post<unknown>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/prepare`, {
      commandType: "prepare_deliberation_manifests",
      commandId: "ri50-expanded-context-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: room.version,
      revisionId: fixture.revisionId,
      allowedContext: { includeBrief: true, decisionIds: [], issueIds: [fixture.issueId], evidenceIds: [], rawProviderResponse: "forbidden" },
    });
    expect(expandedContext.response.status).toBe(400);
    expect(expandedContext.body.error?.code).toBe("invalid_input");

    const preparedResponse = await post<PreparedValue>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/prepare`, {
      commandType: "prepare_deliberation_manifests",
      commandId: "ri50-prepare-room-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: room.version,
      revisionId: fixture.revisionId,
      allowedContext: { includeBrief: true, decisionIds: [], issueIds: [fixture.issueId], evidenceIds: [] },
    });
    const prepared = requireValue(preparedResponse.body);
    expect(prepared).toMatchObject({ schemaVersion: "1.0.0", contextManifestsVisible: true, room: { status: "awaiting_manifest_confirmation", assessments: [] } });
    expect(prepared.manifests[0].canonicalHash).not.toBe(prepared.manifests[1].canonicalHash);
    expect(prepared.manifests.map((manifest) => manifest.participantSlot)).toEqual(["a", "b"]);
    for (const manifest of prepared.manifests) {
      expect(manifest.excludedFields).toEqual(expect.arrayContaining([
        "other_participant_output",
        "other_participant_private_context",
        "other_participant_session",
        "other_participant_request",
        "provider_raw_response",
        "hidden_chain_of_thought",
        "provider_credentials",
        "authority_commands",
        "winner_ranking_score_vote",
      ]));
      expect(manifest.includedObjects.map((item) => item.kind)).toEqual(expect.arrayContaining(["brief", "issue", "revision"]));
    }
    expect(prepared.providerPreviews).toEqual([
      expect.objectContaining({ retryCount: 0, redirectPolicy: "error" }),
      expect.objectContaining({ retryCount: 0, redirectPolicy: "error" }),
    ]);
    expect(prepared).not.toHaveProperty("requests");

    const runBody = {
      commandType: "run_deliberation_blind_round",
      commandId: "ri50-run-room-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: prepared.room.version,
      manifestHashes: prepared.manifests.map((manifest) => manifest.canonicalHash),
    };
    const run = requireValue((await post<RoomValue>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/run`, runBody)).body);
    expect(run).toMatchObject({ status: "reveal_ready", providerCallCount: 2, assessments: [] });
    expect(run.participantStates).toEqual([
      expect.objectContaining({ slot: "a", status: "completed" }),
      expect.objectContaining({ slot: "b", status: "completed" }),
    ]);
    expect(pair.coordinator.calls).toHaveLength(2);
    expect(Math.abs((pair.coordinator.calls[0]?.startedAt ?? 0) - (pair.coordinator.calls[1]?.startedAt ?? 0))).toBeLessThan(100);
    const initialA = pair.coordinator.calls.find((call) => call.slot === "a");
    const initialB = pair.coordinator.calls.find((call) => call.slot === "b");
    expect(JSON.stringify(initialA?.request)).not.toContain("ri50-provider-b");
    expect(JSON.stringify(initialB?.request)).not.toContain("ri50-provider-a");

    const replayedRun = requireValue((await post<RoomValue>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/run`, runBody)).body);
    expect(replayedRun.version).toBe(run.version);
    expect(pair.coordinator.calls).toHaveLength(2);
    const staleReveal = await post<unknown>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/reveal`, { commandType: "reveal_deliberation_round", commandId: "ri50-stale-reveal-0001", confirmed: true, projectId: fixture.projectId, expectedVersion: 99, mode: "complete" });
    expect(staleReveal.response.status).toBe(409);
    expect(staleReveal.body.error?.code).toBe("stale_state");

    const revealed = requireValue((await post<RoomValue>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/reveal`, { commandType: "reveal_deliberation_round", commandId: "ri50-reveal-room-0001", confirmed: true, projectId: fixture.projectId, expectedVersion: run.version, mode: "complete" })).body);
    expect(revealed.assessments).toHaveLength(2);
    expect(revealed).toMatchObject({ status: "difference_review", differenceSummary: { authority: "system_derived", canResolveRoom: false, winner: null, ranking: null, score: null } });
    const difference = requireValue((await (await fetch(`${server.origin}/api/project/deliberation-rooms/${room.id}/difference`)).json()) as ApiEnvelope<{ readonly differenceSummary: RoomValue["differenceSummary"] }>);
    expect(difference.differenceSummary).toMatchObject({ canResolveRoom: false, winner: null, ranking: null, score: null });

    const attention = requireValue((await (await fetch(`${server.origin}/api/project/attention`)).json()) as ApiEnvelope<{ readonly items: readonly { readonly kind: string; readonly sourceObject: { readonly id: string } }[] }>);
    expect(attention.items.some((item) => item.kind === "deliberation_room" && item.sourceObject.id === room.id)).toBe(true);

    const challengePrepared = requireValue((await post<PreparedValue>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/prepare-challenge`, {
      commandType: "prepare_deliberation_challenge",
      commandId: "ri50-prepare-challenge-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: revealed.version,
      question: "Which exact evidence would change your bounded conclusion, and what remains unresolved?",
    })).body);
    expect(challengePrepared).toMatchObject({ sharedContextOnly: true, room: { status: "challenge_prepared" } });
    const challengeId = challengePrepared.room.challenge?.id;
    if (challengeId === undefined) throw new Error("challenge id missing");
    const challenged = requireValue((await post<RoomValue>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/run-challenge`, {
      commandType: "run_deliberation_challenge",
      commandId: "ri50-run-challenge-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: challengePrepared.room.version,
      challengeId,
      manifestHashes: challengePrepared.manifests.map((manifest) => manifest.canonicalHash),
    })).body);
    expect(challenged).toMatchObject({ status: "waiting_user_resolution", providerCallCount: 4, challenge: { status: "completed", userConfirmed: true } });
    expect(pair.coordinator.calls).toHaveLength(4);
    for (const call of pair.coordinator.calls.slice(2)) {
      const kinds = call.request.context.allowedObjects.map((item) => item.kind);
      expect(kinds).toEqual(expect.arrayContaining(["participant_assessment", "difference_summary"]));
      expect(JSON.stringify(call.request.context.allowedObjects)).not.toMatch(/rawProviderResponse|secretRef|authorization|chainOfThought/iu);
    }

    const resolved = requireValue((await post<RoomValue>(server.origin, token, `/api/project/deliberation-rooms/${room.id}/resolve`, {
      commandType: "resolve_deliberation_room",
      commandId: "ri50-resolve-room-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: challenged.version,
      kind: "keep_disputed",
      publicReason: "The research owner preserves the bounded disagreement until discriminating evidence is available.",
      combinedText: "",
    })).body);
    expect(resolved).toMatchObject({ status: "resolved", resolutions: [{ kind: "keep_disputed", receipt: { canonicalMutationAuthorized: false, separateAuthorityRequired: true } }] });
    expect(resolved.trace.map((item) => item.step)).toEqual(expect.arrayContaining(["source", "manifests", "blind_round", "reveal", "difference", "challenge", "user_resolution", "resolution_receipt"]));

    const list = requireValue((await (await fetch(`${server.origin}/api/project/deliberation-rooms?limit=50`)).json()) as ApiEnvelope<{ readonly items: readonly RoomValue[] }>);
    expect(list.items).toEqual([expect.objectContaining({ id: room.id, status: "resolved" })]);
    const search = requireValue((await (await fetch(`${server.origin}/api/project/search?q=Bounded%20interpretation&limit=20`)).json()) as ApiEnvelope<{ readonly items: readonly { readonly kind: string; readonly id: string }[] }>);
    expect(search.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "deliberation_room", id: room.id })]));
    const overview = requireValue((await (await fetch(`${server.origin}/api/project/overview`)).json()) as ApiEnvelope<{ readonly counts: { readonly deliberationRooms: number }; readonly statuses: { readonly deliberationRooms: Readonly<Record<string, number>> } }>);
    expect(overview.counts.deliberationRooms).toBe(1);
    expect(overview.statuses.deliberationRooms).toMatchObject({ resolved: 1 });

    const serialized = JSON.stringify([prepared, run, revealed, challengePrepared, challenged, resolved, list, search, overview]);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toMatch(/state\.sqlite|apiKey|"requestBody"\s*:|"rawProviderResponse"\s*:|"stack"\s*:/iu);
  });

  it("normalizes one participant failure, reveals only the explicit partial result, and labels a manual opinion as non-blind", async () => {
    const { fixture, pair, server, token } = await openFixture({ modeB: "failure" });
    const { prepared } = await createAndPrepare(server.origin, token, fixture, "partial-0001");
    const run = requireValue((await post<RoomValue>(server.origin, token, `/api/project/deliberation-rooms/${prepared.room.id}/run`, {
      commandType: "run_deliberation_blind_round",
      commandId: "ri50-run-partial-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: prepared.room.version,
      manifestHashes: prepared.manifests.map((manifest) => manifest.canonicalHash),
    })).body);
    expect(run).toMatchObject({ status: "reveal_ready", providerCallCount: 2, assessments: [] });
    expect(run.participantStates).toEqual([
      expect.objectContaining({ slot: "a", status: "completed" }),
      expect.objectContaining({ slot: "b", status: "failed" }),
    ]);
    expect(pair.coordinator.calls).toHaveLength(2);

    const partial = requireValue((await post<RoomValue>(server.origin, token, `/api/project/deliberation-rooms/${prepared.room.id}/reveal`, {
      commandType: "reveal_deliberation_round",
      commandId: "ri50-reveal-partial-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: run.version,
      mode: "partial",
    })).body);
    expect(partial).toMatchObject({ status: "partial" });
    expect(partial.assessments).toHaveLength(1);
    expect(partial.differenceSummary).toMatchObject({ authority: "system_derived", canResolveRoom: false, winner: null, ranking: null, score: null });
    expect(partial.differenceSummary?.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unresolved", status: "present" }),
      expect.objectContaining({ kind: "unproven", status: "present" }),
    ]));

    const manual = requireValue((await post<RoomValue>(server.origin, token, `/api/project/deliberation-rooms/${prepared.room.id}/manual-opinion`, {
      commandType: "import_manual_external_opinion",
      commandId: "ri50-manual-opinion-0001",
      confirmed: true,
      projectId: fixture.projectId,
      expectedVersion: partial.version,
      sourceLabel: "User-pasted public opinion",
      providerClaim: "External Provider claim",
      modelClaim: "External model claim",
      capturedAt: "2026-08-27T08:30:00.000Z",
      contextDisclosure: "The opinion saw the public Room question and Participant A output.",
      sawParticipantAOutput: true,
      sawParticipantBOutput: false,
      publicContent: "Retain only the bounded association and request discriminating design evidence.",
    })).body);
    expect(manual.manualExternalOpinions).toEqual([
      expect.objectContaining({
        classification: "manual_non_blind",
        verification: "unverified_external_import",
        blindnessVerification: "not_verifiable",
        exposure: { sawParticipantAOutput: true, sawParticipantBOutput: false },
      }),
    ]);
    expect(manual.trace.map((item) => item.step)).toContain("manual_opinion");
    const difference = requireValue((await (await fetch(`${server.origin}/api/project/deliberation-rooms/${prepared.room.id}/difference`)).json()) as ApiEnvelope<{ readonly differenceSummary: RoomValue["differenceSummary"] }>);
    expect(difference.differenceSummary).toMatchObject({ canResolveRoom: false, winner: null, ranking: null, score: null });
  });
});
