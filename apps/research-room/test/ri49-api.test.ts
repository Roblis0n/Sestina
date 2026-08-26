import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../src/language-preferences.js";
import { createRi49FixtureProject, Ri49IndependentProvider, Ri49OriginalProvider } from "./ri49-test-fixture.js";

class LanguageStore implements LanguagePreferenceStore {
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve("en"); }
  writeLanguage(): Promise<void> { return Promise.resolve(); }
}

const roots: string[] = [];
const servers: RunningResearchRoomServer[] = [];

interface ApiEnvelope<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

interface AppealApiValue {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly kind?: string;
  readonly sourceReceiptId?: string;
  readonly resolutionCount?: number;
  readonly userAuthorityOnly?: boolean;
  readonly canAutoResolve?: boolean;
  readonly latestComparison?: { readonly relation: string; readonly canResolveAppeal: boolean };
}

interface PreparedAppealApiValue {
  readonly schemaVersion: "1.0.0";
  readonly contextManifestVisible: true;
  readonly appeal: AppealApiValue;
  readonly attemptId: string;
  readonly confirmationNonce: string;
  readonly providerPreview: { readonly retryCount: number; readonly redirectPolicy: string };
  readonly manifest: { readonly canonicalHash: string; readonly excludedFields: readonly string[] };
}

function requireValue<T>(envelope: ApiEnvelope<T>): T {
  if (!envelope.ok || envelope.value === undefined) throw new Error(envelope.error?.code ?? "missing_api_value");
  return envelope.value;
}

async function openFixture() {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri49-api-")); roots.push(root);
  const seeded = await createRi49FixtureProject(root);
  const server = await createResearchRoomServer({ languagePreferenceStore: new LanguageStore(), provider: new Ri49OriginalProvider(), correctionAppealSecondOpinionProvider: new Ri49IndependentProvider() }).start(); servers.push(server);
  const status = await (await fetch(`${server.origin}/api/status`)).json() as { value: { sessionToken: string } };
  const token = status.value.sessionToken;
  const opened = await fetch(`${server.origin}/api/project/open`, { method: "POST", headers: { "content-type": "application/json", "x-sestina-session": token }, body: JSON.stringify({ projectPath: root }) });
  expect(opened.status).toBe(200);
  return { root, seeded, server, token };
}

async function post<T>(origin: string, token: string, path: string, body: unknown): Promise<{ readonly response: Response; readonly body: ApiEnvelope<T> }> {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-sestina-session": token }, body: JSON.stringify(body) });
  const raw: unknown = await response.json();
  return { response, body: raw as ApiEnvelope<T> };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (roots.length > 0) { const root = roots.pop(); if (root) await rm(root, { recursive: true, force: true }); }
});

describe("RI-49 production API boundary", () => {
  it("carries one appeal from a committed finding through exact Manifest, independent result, comparison, and user resolution", async () => {
    const { seeded, server, token, root } = await openFixture();
    const receiptResponse = await fetch(`${server.origin}/api/project/receipts/${seeded.receiptId}`);
    const receipt = await receiptResponse.json() as { value: { appealableFindings: { findingId: string; kind: string; action: string; href: string }[] } };
    expect(receiptResponse.status).toBe(200);
    const source = receipt.value.appealableFindings.find((item) => item.kind === "argument_leap") ?? receipt.value.appealableFindings[0];
    if (source === undefined) throw new Error("appealable finding missing");
    expect(source).toMatchObject({ action: "create_appeal" });
    const criterion = source.kind === "argument_delta" ? "argument-delta" : "argument-leap";
    const statement = { disagreement: "The finding reads a stated evidence boundary as the causal claim it limits.", challengedCriterionId: criterion, claimedError: "The finding reverses the function of the qualification.", missingOrMisreadContext: "The frozen sentence explicitly states that the design cannot establish causality.", secondOpinionQuestion: "Does the frozen sentence contain an unsupported causal argument leap?", desiredDisposition: "overturn_original_finding" };

    const wrongProject = await post<unknown>(server.origin, token, "/api/project/appeals", { commandType: "create_correction_appeal", projectId: "rprj_01ARZ3NDEKTSV4RRFFQ69G5FAV", receiptId: seeded.receiptId, findingId: source.findingId, statement, confirmed: true });
    expect(wrongProject.response.status).toBe(409); expect(wrongProject.body.error?.code).toBe("cross_project_reference");
    const created = await post<AppealApiValue>(server.origin, token, "/api/project/appeals", { commandType: "create_correction_appeal", projectId: seeded.projectId, receiptId: seeded.receiptId, findingId: source.findingId, statement, confirmed: true });
    const createdValue = requireValue(created.body);
    expect(created.response.status).toBe(200); expect(createdValue).toMatchObject({ kind: "appeal", status: "draft", sourceReceiptId: seeded.receiptId, userAuthorityOnly: true, canAutoResolve: false });
    const appealId = createdValue.id;

    const stale = await post<unknown>(server.origin, token, `/api/project/appeals/${appealId}/update`, { commandType: "update_correction_appeal", projectId: seeded.projectId, expectedVersion: 99, statement: { ...statement, disagreement: `${statement.disagreement} Stale mutation.` }, confirmed: true });
    expect(stale.response.status).toBe(409); expect(stale.body.error?.code).toBe("stale_state");
    const recorded = await post<AppealApiValue>(server.origin, token, `/api/project/appeals/${appealId}/record`, { commandType: "record_correction_appeal", projectId: seeded.projectId, expectedVersion: createdValue.version, confirmed: true });
    const recordedValue = requireValue(recorded.body);
    expect(recordedValue).toMatchObject({ status: "recorded" });

    const expandedContext = await post<unknown>(server.origin, token, `/api/project/appeals/${appealId}/prepare-second-opinion`, { commandType: "prepare_correction_appeal_second_opinion", projectId: seeded.projectId, expectedVersion: recordedValue.version, allowedContext: { includeBrief: true, decisionIds: [], issueIds: [], evidenceIds: [], rawProviderResponse: "forbidden" }, confirmed: true });
    expect(expandedContext.response.status).toBe(400); expect(expandedContext.body.error?.code).toBe("invalid_input");
    const prepared = await post<PreparedAppealApiValue>(server.origin, token, `/api/project/appeals/${appealId}/prepare-second-opinion`, { commandType: "prepare_correction_appeal_second_opinion", projectId: seeded.projectId, expectedVersion: recordedValue.version, allowedContext: { includeBrief: true, decisionIds: [], issueIds: [], evidenceIds: [] }, confirmed: true });
    const preparedValue = requireValue(prepared.body);
    expect(prepared.response.status).toBe(200);
    expect(preparedValue).toMatchObject({ schemaVersion: "1.0.0", contextManifestVisible: true, appeal: { status: "awaiting_send_confirmation" }, providerPreview: { retryCount: 0, redirectPolicy: "error" } });
    for (const excluded of ["original_verdict", "original_public_rationale", "original_confidence", "original_provider_raw_response", "other_agent_assessments"]) expect(preparedValue.manifest.excludedFields).toContain(excluded);
    expect(preparedValue).not.toHaveProperty("request");

    const run = await post<AppealApiValue>(server.origin, token, `/api/project/appeals/${appealId}/run-second-opinion`, { commandType: "run_correction_appeal_second_opinion", projectId: seeded.projectId, expectedVersion: preparedValue.appeal.version, attemptId: preparedValue.attemptId, confirmationNonce: preparedValue.confirmationNonce, manifestHash: preparedValue.manifest.canonicalHash, confirmed: true });
    const runValue = requireValue(run.body);
    expect(run.response.status).toBe(200); expect(runValue).toMatchObject({ status: "second_opinion_ready", latestComparison: { relation: "direct_contradiction", canResolveAppeal: false } });
    const resolved = await post<AppealApiValue>(server.origin, token, `/api/project/appeals/${appealId}/resolve`, { commandType: "resolve_correction_appeal", projectId: seeded.projectId, expectedVersion: runValue.version, kind: "modify_finding_interpretation", publicReason: "The original receipt remains intact; this resolution records the bounded alternative interpretation.", confirmed: true });
    const resolvedValue = requireValue(resolved.body);
    expect(resolved.response.status).toBe(200); expect(resolvedValue).toMatchObject({ status: "resolved", resolutionCount: 1, userAuthorityOnly: true });

    const list = await (await fetch(`${server.origin}/api/project/appeals?limit=50`)).json() as ApiEnvelope<{ readonly items: readonly AppealApiValue[] }>;
    expect(requireValue(list).items).toMatchObject([{ id: appealId, status: "resolved" }]);
    const serialized = JSON.stringify([created.body, prepared.body, run.body, resolved.body]);
    expect(serialized).not.toContain(root); expect(serialized).not.toMatch(/apiKey|rawProviderResponse|state\.sqlite|SQLITE|stack/iu);
  });

  it("reports the independent injected connection separately from the original judge", async () => {
    const { server } = await openFixture();
    const primary = await (await fetch(`${server.origin}/api/provider`)).json() as { value: unknown };
    const second = await (await fetch(`${server.origin}/api/second-opinion-provider`)).json() as { value: unknown };
    expect(primary.value).toMatchObject({ mode: "configured", injected: true });
    expect(second.value).toMatchObject({ mode: "configured", injected: true });
    expect(second.value).not.toBe(primary.value);
  });
});
