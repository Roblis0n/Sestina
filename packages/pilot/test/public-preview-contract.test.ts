import { describe, expect, it } from "vitest";

import {
  DESKTOP_NEEDS,
  DESKTOP_SOLUTION_EVIDENCE,
  DISTRIBUTION_SOURCES,
  FRICTION_SEVERITIES,
  PILOT_CONSENT_VERSION,
  PILOT_KIT_VERSION,
  PILOT_PROTOCOL_VERSION,
  RELEASE_PLATFORMS,
  SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION,
  STEP_OUTCOMES,
  createShareablePilotExport,
} from "../src/index.js";

describe("RI-54 participant-owned Research Room Pilot contract", () => {
  it("uses the 0.2 public-preview protocol and exact supported distributions", () => {
    expect(SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION).toBe("2.0.0");
    expect(PILOT_KIT_VERSION).toBe("2.0.0");
    expect(PILOT_PROTOCOL_VERSION).toBe("2026-08-30");
    expect(PILOT_CONSENT_VERSION).toBe("2026-08-30");
    expect(RELEASE_PLATFORMS).toEqual([
      "windows_x64",
      "macos_arm64",
      "ubuntu_x64",
    ]);
    expect(DISTRIBUTION_SOURCES).toContain("github_release");
    expect(STEP_OUTCOMES).toEqual(["success", "failure", "not_observed"]);
    expect(FRICTION_SEVERITIES).toContain("blocking");
    expect(DESKTOP_NEEDS).toContain("required");
    expect(DESKTOP_SOLUTION_EVIDENCE).toContain("blocking_without_desktop");
  });

  it("exports exact behavior facts without free text, identity, paths, devices, secrets, or raw errors", () => {
    const value = createShareablePilotExport({
      schemaVersion: "2.0.0",
      participantCode: "EXT-0001",
      sessionId: `ps_${"1".repeat(32)}`,
      evidenceId: `pe_${"2".repeat(24)}`,
      sessionOrdinal: 1,
      participantRole: "external_researcher",
      hostEntry: "research_room",
      materialType: "paper",
      sessionDate: "2026-08-30",
      totalDurationMinutes: 42,
      releasePlatform: "windows_x64",
      distributionSource: "github_release",
      releaseSourceCommit: "3".repeat(40),
      releaseAssetSha256: "4".repeat(64),
      operatingMode: "ledger_only",
      distribution: {
        download: { outcome: "success", durationMinutes: 2 },
        checksumVerification: { outcome: "success", durationMinutes: 1 },
        extraction: { outcome: "success", durationMinutes: 1 },
        firstLaunch: { outcome: "success", durationMinutes: 2 },
        timeToRoomMinutes: 6,
        failurePoint: null,
      },
      journey: {
        project: "completed",
        brief: "completed",
        review: "completed",
        manifest: "completed",
        disposition: "completed",
        receipt: "completed",
        recovery: "not_needed",
        relaunch: "success",
      },
      localWebLifecycle: {
        outcome: "success",
        frictionSeverity: "minor",
        blocking: false,
      },
      setup: { outcome: "success", durationMinutes: 6 },
      episode: { outcome: "completed", durationMinutes: 30 },
      exitResult: "completed",
      exitPoint: null,
      repeatCorrectionImpact: "reduced",
      findingAssessment: { necessary: 2, unnecessary: 0, uncertain: 1 },
      maintenanceBurden: {
        brief: 2,
        decision: 2,
        issue: 2,
        manifest: 2,
        recovery: 1,
      },
      secondUseObserved: false,
      preferredEntry: "research_room",
      desktopNeed: "helpful",
      desktopSolutionEvidence: "self_report_only",
      uiNeed: "yes",
      syntheticCaseDiscussion: "undecided",
      wouldUseAgain: "yes",
      failureObserved: false,
      negativeFeedbackObserved: false,
      consentVersion: "2026-08-30",
      protocolVersion: "2026-08-30",
      pilotKitVersion: "2.0.0",
      releaseVersion: "0.2.0",
      releaseChannel: "public_preview",
      releaseBuildId: "5".repeat(64),
    });
    const serialized = JSON.stringify(value);
    for (const forbidden of [
      "notes",
      "researchContent",
      "identity",
      "projectPath",
      "deviceId",
      "secret",
      "rawError",
      "stdout",
      "stderr",
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });
});
