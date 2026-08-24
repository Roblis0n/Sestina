import { describe, expect, it } from "vitest";
import * as coreApi from "../src/index.js";

describe("@sestina/core public boundary", () => {
  it("exports the application entry without storage or repository internals", () => {
    expect(Object.keys(coreApi).sort()).toEqual([
      "SestinaCore", "compileResearchRoomSemanticJudgePrompt", "coreErr", "coreOk", "createProjectStateBackup",
      "createSecretBackend", "createStableTextSpan", "getPrivacyManifest", "getReleaseIdentity", "inspectProjectRecovery",
      "openSestina", "prepareResearchRoomSemanticJudge", "previewProjectStateRestore", "RELEASE_IDENTITY", "restoreProjectState",
    ].sort());
    expect(coreApi).not.toHaveProperty("openDatabase");
    expect(coreApi).not.toHaveProperty("createResearchStore");
    expect(coreApi).not.toHaveProperty("withTransaction");
  });

  it("keeps the complete RI-24 use-case surface on the single application service", () => {
    const methods = Object.getOwnPropertyNames(coreApi.SestinaCore.prototype);
    expect(methods).toEqual(expect.arrayContaining([
      "initializeProject",
      "createArtifact",
      "createRevision",
      "activateBrief",
      "recordDecision",
      "openIssue",
      "startRevisionEpisode",
      "submitCandidateRevision",
      "runDeterministicReview",
      "recordUserDisposition",
      "createResearchSnapshot",
      "renderReviewReport",
      "exportCapsule",
    ]));
  });
});
