import { describe, expect, it } from "vitest";
import * as coreApi from "../src/index.js";
import { mapDomainError } from "../src/errors.js";

describe("@sestina/core public boundary", () => {
  it("exports the application entry without storage or repository internals", () => {
    expect(Object.keys(coreApi).sort()).toEqual([
      "SestinaCore", "compileCorrectionAppealSecondOpinionPrompt", "compileDeliberationParticipantPrompt", "compileResearchRoomSemanticJudgePrompt", "coreErr", "coreOk",
      "createCorrectionAppealProviderEndpointIdentityHash", "createProjectStateBackup", "createSecretBackend", "createStableTextSpan",
      "getPrivacyManifest", "getReleaseIdentity", "getResearchRoomSemanticCriterionDefinition", "inspectProjectRecovery", "openSestina",
      "prepareCorrectionAppealSecondOpinionRequest", "prepareResearchRoomSemanticJudge", "previewProjectStateRestore", "RELEASE_IDENTITY",
      "restoreProjectState", "submitCorrectionAppealSecondOpinion",
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

  it("preserves actionable local-storage causes at the Core boundary", () => {
    expect(mapDomainError({ code: "database_unavailable" }).code).toBe("storage_unavailable");
    expect(mapDomainError({ code: "database_readonly" }).code).toBe("storage_readonly");
    expect(mapDomainError({ code: "database_corrupt" }).code).toBe("storage_corrupt");
    expect(mapDomainError({ code: "storage_busy" }).code).toBe("storage_busy");
    expect(mapDomainError({ code: "research_storage_unavailable" }).code).toBe("infrastructure_failure");
    expect(mapDomainError({ code: "review_storage_unavailable" }).code).toBe("infrastructure_failure");
  });
});
