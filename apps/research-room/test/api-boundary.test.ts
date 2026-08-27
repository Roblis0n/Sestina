import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ApiPayloadError,
  decodeAnalyzedReview,
  decodeApiEnvelope,
  decodeDirectoryPickerCancellation,
  decodeProjectOpenResult,
  decodeProjectOverview,
  decodeProjectMemoryManifest,
  decodeProjectMemoryProjection,
  decodeResearchObjectDetail,
  decodeResearchObjectSearch,
  decodeResearchRoomState,
  decodeStatus,
  decodeWorkspacePage,
} from "../client/src/api/decoders.js";
import { localizedError } from "../client/src/i18n/copy.js";

describe("Research Room typed API boundary", () => {
  it("localizes key Chinese recovery errors while preserving stable error codes separately", () => {
    const offline = Object.assign(new Error("The local Research Room is unavailable."), { code: "offline" });
    const invalid = Object.assign(new Error("Invalid analyzed review payload."), { code: "invalid_payload" });
    const infrastructure = Object.assign(new Error("The local research state is unavailable."), { code: "infrastructure_failure" });
    const unavailable = Object.assign(new Error("The database path is unavailable."), { code: "storage_unavailable" });
    const readonly = Object.assign(new Error("The database is read-only."), { code: "storage_readonly" });
    const busy = Object.assign(new Error("The database is busy."), { code: "storage_busy" });
    expect(localizedError("zh-CN", offline)).toContain("本地服务");
    expect(localizedError("zh-CN", invalid)).toContain("已拒绝使用");
    expect(localizedError("en", offline)).toBe(
      "The local Research Room is unavailable. Confirm the local service is running, then retry.",
    );
    expect(localizedError("zh-CN", infrastructure)).toContain("当前项目的本地研究状态");
    expect(localizedError("zh-CN", infrastructure)).not.toContain("state.sqlite");
    expect(localizedError("en", infrastructure)).toContain("current project's local research state");
    expect(localizedError("en", infrastructure)).not.toContain("state.sqlite");
    expect(localizedError("en", infrastructure)).not.toContain("&#x20;");
    expect(localizedError("zh-CN", unavailable)).toContain("启动方式");
    expect(localizedError("zh-CN", unavailable)).toContain(".sestina/state.sqlite");
    expect(localizedError("zh-CN", readonly)).toContain("写入权限");
    expect(localizedError("zh-CN", busy)).toContain("其他 Sestina 实例");
  });

  it("decodes the local status envelope without widening the session contract", () => {
    const value = decodeApiEnvelope(
      {
        ok: true,
        value: {
          localOnly: true,
          telemetry: false,
          projectOpen: false,
          directoryPickerAvailable: true,
          languagePreference: "zh-CN",
          sessionToken: "a".repeat(64),
        },
      },
      decodeStatus,
    );

    expect(value).toMatchObject({
      localOnly: true,
      telemetry: false,
      languagePreference: "zh-CN",
    });
  });

  it("fails closed on a success envelope whose payload has the wrong shape", () => {
    expect(() =>
      decodeApiEnvelope(
        { ok: true, value: { localOnly: "yes", sessionToken: 42 } },
        decodeStatus,
      ),
    ).toThrow(ApiPayloadError);
  });

  it("preserves a stable server error without treating it as a value", () => {
    let thrown: unknown;
    try {
      decodeApiEnvelope(
        {
          ok: false,
          error: { code: "project_not_open", message: "Open a project first." },
        },
        decodeStatus,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiPayloadError);
    if (!(thrown instanceof ApiPayloadError)) throw new Error("Expected ApiPayloadError");
    expect(thrown.code).toBe("project_not_open");
  });

  it("fails closed when the native-picker cancellation acknowledgement is not exact", () => {
    expect(decodeDirectoryPickerCancellation({ cancelRequested: true })).toEqual({ cancelRequested: true });
    expect(() => decodeDirectoryPickerCancellation({ cancelRequested: "yes" })).toThrow(ApiPayloadError);
    expect(() => decodeDirectoryPickerCancellation({ cancelRequested: true, path: "C:\\private" })).toThrow(ApiPayloadError);
  });

  it("rejects project-open payloads that expose a path or claim a scan", () => {
    expect(() =>
      decodeProjectOpenResult({
        project: { id: "p1", title: "Research" },
        initialized: false,
        setupRequired: false,
        localOnly: true,
        pathPersisted: false,
        directoryScanPerformed: false,
        root: "C:\\private",
      }),
    ).toThrow(ApiPayloadError);

    expect(() =>
      decodeProjectOpenResult({
        project: { id: "p1", title: "Research" },
        initialized: false,
        setupRequired: false,
        localOnly: true,
        pathPersisted: false,
        directoryScanPerformed: true,
      }),
    ).toThrow(ApiPayloadError);
  });

  it("requires the complete state projection needed by the Shell", () => {
    expect(() =>
      decodeResearchRoomState({ project: { id: "p1", title: "Research" } }),
    ).toThrow(ApiPayloadError);
  });

  it("does not accept semantic_ready without a complete nine-assessment trace", () => {
    expect(() =>
      decodeAnalyzedReview({
        reviewId: "r1",
        authorityNonce: "n1",
        stateBinding: {},
        providerStatus: "semantic_ready",
        manifest: { networkUsed: true, sendStatus: "sent_to_provider" },
        analysis: {
          findings: [],
          argumentDelta: {
            genuineAdditions: [],
            alternativeExplanations: [],
            unknowns: [],
            unproven: [],
            summary: "",
          },
          alternativeExplanations: [],
          unknowns: [],
          unproven: [],
          minimalCorrection: "",
        },
        semanticJudge: { assessments: [] },
      }),
    ).toThrow(ApiPayloadError);
  });

  it("decodes exact UI-02 overview and bounded Decision pages while rejecting sensitive or unknown fields", () => {
    const overview = {
      schemaVersion: "1.0.0",
      project: { id: "rprj_01ARZ3NDEKTSV4RRFFQ69G5FAV", title: "Research", version: 1, updatedAt: "2026-08-25T00:00:00.000Z" },
      providerStatus: "ledger_only",
      brief: { id: "rbrf_01ARZ3NDEKTSV4RRFFQ69G5FAV", versionId: "rbrf_01ARZ3NDEKTSV4RRFFQ69G5FAW", versionNumber: 1, question: "Question", stage: "revision", task: "Task" },
      counts: { decisions: 1, issues: 0, evidence: 0, episodes: 0, receipts: 0, appeals: 0, deliberationRooms: 0 },
      statuses: { decisions: { proposed: 1 }, issues: {}, evidence: {}, episodes: {}, receipts: {}, appeals: {}, deliberationRooms: {} },
      attention: { total: 1, top: [{ id: "rdec_01ARZ3NDEKTSV4RRFFQ69G5FAV", kind: "decision", title: "Decision", reason: "Pending", severity: "high", href: "/project/decisions/rdec_01ARZ3NDEKTSV4RRFFQ69G5FAV", primaryAction: "Open Decision", sourceObject: { kind: "decision", id: "rdec_01ARZ3NDEKTSV4RRFFQ69G5FAV" }, valid: true, createdAt: "2026-08-25T00:00:00.000Z" }] },
      recentChanges: [],
    };
    expect(decodeProjectOverview(overview)).toMatchObject({ schemaVersion: "1.0.0", counts: { decisions: 1 } });
    expect(() => decodeProjectOverview({ ...overview, rootPath: "H:\\AI" })).toThrow(ApiPayloadError);

    const page = {
      schemaVersion: "1.0.0", projectId: overview.project.id, datasetVersion: "a".repeat(64),
      items: [{ kind: "decision", id: "rdec_01ARZ3NDEKTSV4RRFFQ69G5FAV", statement: "Decision", status: "proposed", scope: { kind: "project" }, rationale: "Reason", effectiveBriefVersionId: overview.brief.versionId, reopenConditions: [], active: false, referencedByCurrentBrief: true, version: 1, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z", provenance: { authority: "user_recorded", actorKind: "user", recordedAt: "2026-08-25T00:00:00.000Z" } }],
    };
    expect(decodeWorkspacePage(page, "decision").items).toHaveLength(1);
    expect(() => decodeWorkspacePage({ ...page, items: [{ ...page.items[0], stack: "private" }] }, "decision")).toThrow(ApiPayloadError);
    expect(() => decodeWorkspacePage({ ...page, schemaVersion: "2.0.0" }, "decision")).toThrow(ApiPayloadError);

    const detail = { ...page.items[0], availableActions: ["accept", "reject"], timeline: [], lineage: [{ id: page.items[0]?.id, statement: "Decision", status: "proposed", version: 1, relation: "current" }], lineageTruncated: false, relatedBriefVersionIds: [overview.brief.versionId], relatedIssueIds: [], relatedEpisodeIds: [], relatedReceiptIds: [], relationsTruncated: false };
    expect(decodeResearchObjectDetail(detail, "decision")).toMatchObject({ kind: "decision", lineage: [{ relation: "current" }] });
    const withoutLineage = Object.fromEntries(Object.entries(detail).filter(([key]) => key !== "lineage"));
    expect(() => decodeResearchObjectDetail(withoutLineage, "decision")).toThrow(ApiPayloadError);

    const search = { schemaVersion: "1.0.0", projectId: overview.project.id, datasetVersion: "b".repeat(64), query: "Decision", truncated: false, items: [{ kind: "decision", id: page.items[0]?.id, title: "Decision", detail: "Reason", status: "proposed", source: "user_recorded:user", projectId: overview.project.id, href: `/project/decisions/${page.items[0]?.id}` }] };
    expect(decodeResearchObjectSearch(search).items).toHaveLength(1);
    expect(() => decodeResearchObjectSearch({ ...search, items: [{ ...search.items[0], projectId: "rprj_01ARZ3NDEKTSV4RRFFQ69G5FAX" }] })).toThrow(ApiPayloadError);
  });

  it("decodes the exact RI-51 project-memory boundary and fails closed on forgotten content or unknown fields", () => {
    const projectId = "rprj_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const itemId = "rmem_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const projection = {
      schemaVersion: "1.0.0",
      projectId,
      projectState: {
        authorityClass: "kernel_authoritative_projection",
        projectVersion: 1,
        projectQuestion: "How should the argument change?",
        currentTask: "Review the evidence boundary",
        activeDecisions: [],
        openIssues: [],
        activeAppeals: [],
        activeDeliberations: [],
        unproven: ["external_user_value"],
        stateHash: "a".repeat(64),
      },
      workingMemory: {
        authorityClass: "working_memory_non_authoritative",
        items: [{
          id: itemId,
          projectId,
          authorityClass: "working_memory_non_authoritative",
          state: "candidate",
          version: 1,
          recallEligible: false,
          manifestEligible: false,
          content: { text: "Compare the competing mechanism claims." },
          contentHash: "b".repeat(64),
          kind: "working_hint",
          source: { kind: "direct_user", actorId: "local-user" },
          retention: { policy: "until_unpinned" },
          sensitivity: "project_private",
          outboundPolicy: "never_send",
          semanticConflict: "semantic_conflict_unchecked",
          createdAt: "2026-08-27T00:00:00.000Z",
          updatedAt: "2026-08-27T00:00:00.000Z",
          transitions: [{ action: "created", to: "candidate", actor: "user", at: "2026-08-27T00:00:00.000Z", publicReason: "User-created candidate" }],
        }],
        activeCount: 0,
        semanticConflict: "semantic_conflict_unchecked",
        defaultOutboundPolicy: "never_send",
      },
      resume: { authorityClass: "resume_checkpoint_non_authoritative", reviewed: false },
      attention: [{ id: itemId, kind: "memory_candidate", title: "Memory candidate", reason: "Awaiting confirmation", href: "/project/memory", severity: "normal" }],
    };
    expect(decodeProjectMemoryProjection(projection).workingMemory.items[0]?.state).toBe("candidate");
    expect(() => decodeProjectMemoryProjection({ ...projection, rootPath: "H:\\AI" })).toThrow(ApiPayloadError);
    expect(() => decodeProjectMemoryProjection({
      ...projection,
      workingMemory: { ...projection.workingMemory, items: [{ id: itemId, projectId, authorityClass: "working_memory_non_authoritative", state: "forgotten", version: 2, recallEligible: false, manifestEligible: false, forgottenAt: "2026-08-27T00:01:00.000Z", tombstone: "irreversible_forget_recorded", content: { text: "must not survive" } }] },
    })).toThrow(ApiPayloadError);

    const manifest = {
      schemaVersion: "1.0.0",
      manifestId: "rman_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      projectId,
      authorityClass: "explicit_context_manifest_non_authoritative",
      status: "previewed",
      provider: { id: "none", kind: "none", configHash: "c".repeat(64), networkRequired: false },
      projectStateHash: "a".repeat(64),
      included: [],
      excluded: [{ itemId, state: "candidate", reason: "candidate_not_confirmed" }],
      providerPayload: { schemaVersion: "1.0.0", projectId, authority: "working_memory_context_only_non_authoritative", items: [] },
      manifestHash: "d".repeat(64),
      confirmationNonce: "confirm-memory-context-123456",
      createdAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2026-08-27T00:15:00.000Z",
      version: 1,
    };
    expect(decodeProjectMemoryManifest(manifest).providerPayload.items).toEqual([]);
    expect(() => decodeProjectMemoryManifest({ ...manifest, alwaysSend: true })).toThrow(ApiPayloadError);
  });

  it("gives high contrast an opaque dark base with vivid accent, status, and focus colors", async () => {
    const css = await readFile(join(import.meta.dirname, "..", "client", "src", "styles", "tokens.css"), "utf8");
    const block = /:root\[data-theme="high_contrast"\]\s*\{(?<tokens>[\s\S]*?)\n\}/u.exec(css)?.groups?.tokens;
    expect(block).toBeDefined();
    expect(block).toContain("--surface-canvas: #020817");
    expect(block).toContain("--surface-primary: #000000");
    expect(block).toContain("--text-primary: #ffffff");
    expect(block).toContain("--accent-primary: #00e5ff");
    expect(block).toContain("--status-ready-bg: #39ff88");
    expect(block).toContain("--status-warning-bg: #ffd400");
    expect(block).toContain("--status-danger-bg: #d50032");
    expect(block).toContain("--focus-ring: #ff2bd6");
    expect(block).not.toContain("rgba(");
  });
});
