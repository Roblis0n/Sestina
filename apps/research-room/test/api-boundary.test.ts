import { describe, expect, it } from "vitest";
import {
  ApiPayloadError,
  decodeAnalyzedReview,
  decodeApiEnvelope,
  decodeProjectOpenResult,
  decodeResearchRoomState,
  decodeStatus,
} from "../client/src/api/decoders.js";
import { localizedError } from "../client/src/i18n/copy.js";

describe("Research Room typed API boundary", () => {
  it("localizes key Chinese recovery errors while preserving stable error codes separately", () => {
    const offline = Object.assign(new Error("The local Research Room is unavailable."), { code: "offline" });
    const invalid = Object.assign(new Error("Invalid analyzed review payload."), { code: "invalid_payload" });
    expect(localizedError("zh-CN", offline)).toContain("本地服务");
    expect(localizedError("zh-CN", invalid)).toContain("已拒绝使用");
    expect(localizedError("en", offline)).toBe("The local Research Room is unavailable.");
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
});
