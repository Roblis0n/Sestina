import {
  PILOT_CONSENT_VERSION,
  PILOT_KIT_VERSION,
  PILOT_PROTOCOL_VERSION,
  SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION,
  type UnsignedShareablePilotExport,
} from "../src/index.js";

export function unsignedExport(
  overrides: Partial<UnsignedShareablePilotExport> = {},
): UnsignedShareablePilotExport {
  return {
    schemaVersion: SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION,
    participantCode: "EXT-0001",
    sessionId: "ps_11111111111111111111111111111111",
    evidenceId: "pe_111111111111111111111111",
    sessionOrdinal: 1,
    participantRole: "external_researcher",
    hostEntry: "cli",
    materialType: "paper",
    sessionDate: "2026-08-21",
    totalDurationMinutes: 55,
    setup: { outcome: "success", durationMinutes: 8 },
    episode: { outcome: "completed", durationMinutes: 31 },
    exitResult: "completed",
    exitPoint: null,
    repeatCorrectionImpact: "reduced",
    findingAssessment: { necessary: 3, unnecessary: 1, uncertain: 0 },
    maintenanceBurden: { brief: 2, decision: 3, issue: 2 },
    secondUseObserved: false,
    preferredEntry: "cli",
    uiNeed: "no",
    syntheticCaseDiscussion: "undecided",
    wouldUseAgain: "yes",
    failureObserved: false,
    negativeFeedbackObserved: false,
    consentVersion: PILOT_CONSENT_VERSION,
    protocolVersion: PILOT_PROTOCOL_VERSION,
    pilotKitVersion: PILOT_KIT_VERSION,
    releaseVersion: "0.1.0",
    releaseBuildId:
      "86469e5ccc3c3b593084c6207545a4d8bfd1d23f19016d1d63973b49052c3085",
    ...overrides,
  };
}
