import { createHash } from "node:crypto";

export const PRIVATE_PILOT_SESSION_SCHEMA_VERSION = "2.0.0" as const;
export const SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION = "2.0.0" as const;
export const PILOT_AGGREGATE_SCHEMA_VERSION = "2.0.0" as const;
export const PILOT_KIT_MANIFEST_SCHEMA_VERSION = "2.0.0" as const;
export const PILOT_KIT_VERSION = "2.0.0" as const;
export const PILOT_PROTOCOL_VERSION = "2026-08-30" as const;
export const PILOT_CONSENT_VERSION = "2026-08-30" as const;

export const PARTICIPANT_ROLES = [
  "external_researcher",
  "project_owner",
  "internal_test",
] as const;
export const HOST_ENTRIES = [
  "research_room",
  "research_room_with_mcp",
  "recovery_cli",
  "multiple",
] as const;
export const MATERIAL_TYPES = [
  "paper",
  "chapter",
  "research_plan",
  "report",
  "other",
] as const;
export const REPEAT_CORRECTION_IMPACTS = [
  "reduced",
  "unchanged",
  "increased",
  "uncertain",
] as const;
export const PREFERRED_ENTRIES = [
  "research_room",
  "research_room_with_mcp",
  "recovery_cli",
  "multiple",
  "none",
] as const;
export const UI_NEEDS = ["yes", "no", "uncertain"] as const;
export const SYNTHETIC_CASE_DISCUSSION_VALUES = [
  "yes",
  "no",
  "undecided",
] as const;
export const WOULD_USE_AGAIN_VALUES = ["yes", "no", "uncertain"] as const;
export const SESSION_EXIT_RESULTS = ["completed", "exited", "abandoned"] as const;
export const PILOT_EXIT_POINTS = [
  "download",
  "checksum_verification",
  "extraction",
  "first_launch",
  "project",
  "brief",
  "review",
  "manifest",
  "disposition",
  "receipt",
  "recovery",
  "relaunch",
  "second_task",
  "local_web_lifecycle",
  "other",
] as const;
export const RELEASE_PLATFORMS = [
  "windows_x64",
  "macos_arm64",
  "ubuntu_x64",
] as const;
export const DISTRIBUTION_SOURCES = ["github_release", "local_build"] as const;
export const OPERATING_MODES = ["ledger_only", "provider_configured"] as const;
export const STEP_OUTCOMES = ["success", "failure", "not_observed"] as const;
export const JOURNEY_OUTCOMES = [
  "completed",
  "not_completed",
  "not_observed",
] as const;
export const RECOVERY_OUTCOMES = [
  "success",
  "failure",
  "not_needed",
  "not_observed",
] as const;
export const FRICTION_SEVERITIES = ["none", "minor", "major", "blocking"] as const;
export const DESKTOP_NEEDS = ["none", "helpful", "required", "uncertain"] as const;
export const DESKTOP_SOLUTION_EVIDENCE = [
  "none",
  "self_report_only",
  "observed_workaround",
  "blocking_without_desktop",
  "uncertain",
] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export type HostEntry = (typeof HOST_ENTRIES)[number];
export type MaterialType = (typeof MATERIAL_TYPES)[number];
export type RepeatCorrectionImpact =
  (typeof REPEAT_CORRECTION_IMPACTS)[number];
export type PreferredEntry = (typeof PREFERRED_ENTRIES)[number];
export type UiNeed = (typeof UI_NEEDS)[number];
export type SyntheticCaseDiscussion =
  (typeof SYNTHETIC_CASE_DISCUSSION_VALUES)[number];
export type WouldUseAgain = (typeof WOULD_USE_AGAIN_VALUES)[number];
export type SessionExitResult = (typeof SESSION_EXIT_RESULTS)[number];
export type PilotExitPoint = (typeof PILOT_EXIT_POINTS)[number];
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];
export type DistributionSource = (typeof DISTRIBUTION_SOURCES)[number];
export type OperatingMode = (typeof OPERATING_MODES)[number];
export type StepOutcome = (typeof STEP_OUTCOMES)[number];
export type JourneyOutcome = (typeof JOURNEY_OUTCOMES)[number];
export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number];
export type FrictionSeverity = (typeof FRICTION_SEVERITIES)[number];
export type DesktopNeed = (typeof DESKTOP_NEEDS)[number];
export type DesktopSolutionEvidence =
  (typeof DESKTOP_SOLUTION_EVIDENCE)[number];
export type BurdenScore = 1 | 2 | 3 | 4 | 5;

export interface ShareableSetupResult {
  readonly outcome: "success" | "failure" | "not_observed";
  readonly durationMinutes: number | null;
}

export interface ShareableEpisodeResult {
  readonly outcome: "completed" | "not_completed" | "not_observed";
  readonly durationMinutes: number | null;
}

export interface FindingAssessmentCounts {
  readonly necessary: number;
  readonly unnecessary: number;
  readonly uncertain: number;
}

export interface MaintenanceBurdenScores {
  readonly brief: BurdenScore;
  readonly decision: BurdenScore;
  readonly issue: BurdenScore;
  readonly manifest: BurdenScore;
  readonly recovery: BurdenScore;
}

export interface PilotStepObservation {
  readonly outcome: StepOutcome;
  readonly durationMinutes: number | null;
}

export interface PilotDistributionObservation {
  readonly download: PilotStepObservation;
  readonly checksumVerification: PilotStepObservation;
  readonly extraction: PilotStepObservation;
  readonly firstLaunch: PilotStepObservation;
  readonly timeToRoomMinutes: number | null;
  readonly failurePoint: PilotExitPoint | null;
}

export interface PilotJourneyObservation {
  readonly project: JourneyOutcome;
  readonly brief: JourneyOutcome;
  readonly review: JourneyOutcome;
  readonly manifest: JourneyOutcome;
  readonly disposition: JourneyOutcome;
  readonly receipt: JourneyOutcome;
  readonly recovery: RecoveryOutcome;
  readonly relaunch: StepOutcome;
}

export interface LocalWebLifecycleObservation {
  readonly outcome: StepOutcome;
  readonly frictionSeverity: FrictionSeverity;
  readonly blocking: boolean;
}

export interface UnsignedShareablePilotExport {
  readonly schemaVersion: typeof SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION;
  readonly participantCode: string;
  readonly sessionId: string;
  readonly evidenceId: string;
  readonly sessionOrdinal: 1 | 2;
  readonly participantRole: ParticipantRole;
  readonly hostEntry: HostEntry;
  readonly materialType: MaterialType;
  readonly sessionDate: string;
  readonly totalDurationMinutes: number;
  readonly releasePlatform: ReleasePlatform;
  readonly distributionSource: DistributionSource;
  readonly releaseSourceCommit: string;
  readonly releaseAssetSha256: string;
  readonly operatingMode: OperatingMode;
  readonly distribution: PilotDistributionObservation;
  readonly journey: PilotJourneyObservation;
  readonly localWebLifecycle: LocalWebLifecycleObservation;
  readonly setup: ShareableSetupResult;
  readonly episode: ShareableEpisodeResult;
  readonly exitResult: SessionExitResult;
  readonly exitPoint: PilotExitPoint | null;
  readonly repeatCorrectionImpact: RepeatCorrectionImpact;
  readonly findingAssessment: FindingAssessmentCounts;
  readonly maintenanceBurden: MaintenanceBurdenScores;
  readonly secondUseObserved: boolean;
  readonly preferredEntry: PreferredEntry;
  readonly desktopNeed: DesktopNeed;
  readonly desktopSolutionEvidence: DesktopSolutionEvidence;
  readonly uiNeed: UiNeed;
  readonly syntheticCaseDiscussion: SyntheticCaseDiscussion;
  readonly wouldUseAgain: WouldUseAgain;
  readonly failureObserved: boolean;
  readonly negativeFeedbackObserved: boolean;
  readonly consentVersion: typeof PILOT_CONSENT_VERSION;
  readonly protocolVersion: typeof PILOT_PROTOCOL_VERSION;
  readonly pilotKitVersion: typeof PILOT_KIT_VERSION;
  readonly releaseVersion: string;
  readonly releaseChannel: "public_preview";
  readonly releaseBuildId: string;
}

export interface ShareablePilotExport extends UnsignedShareablePilotExport {
  readonly contentHash: string;
}

const UNSIGNED_EXPORT_KEYS = [
  "schemaVersion",
  "participantCode",
  "sessionId",
  "evidenceId",
  "sessionOrdinal",
  "participantRole",
  "hostEntry",
  "materialType",
  "sessionDate",
  "totalDurationMinutes",
  "releasePlatform",
  "distributionSource",
  "releaseSourceCommit",
  "releaseAssetSha256",
  "operatingMode",
  "distribution",
  "journey",
  "localWebLifecycle",
  "setup",
  "episode",
  "exitResult",
  "exitPoint",
  "repeatCorrectionImpact",
  "findingAssessment",
  "maintenanceBurden",
  "secondUseObserved",
  "preferredEntry",
  "desktopNeed",
  "desktopSolutionEvidence",
  "uiNeed",
  "syntheticCaseDiscussion",
  "wouldUseAgain",
  "failureObserved",
  "negativeFeedbackObserved",
  "consentVersion",
  "protocolVersion",
  "pilotKitVersion",
  "releaseVersion",
  "releaseChannel",
  "releaseBuildId",
] as const;

function fail(code: string): never {
  throw new Error(code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectExactKeys(
  value: unknown,
  keys: readonly string[],
  code: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(code);
  }
}

export function canonicalStringify(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(normalize);
    if (isRecord(item)) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])]),
      );
    }
    return item;
  }
  return JSON.stringify(normalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(code);
  return value as T;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    fail(code);
  }
  return value as number;
}

function booleanValue(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") fail(code);
  return value;
}

function parseDate(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(code);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) fail(code);
  const canonical = new Date(timestamp).toISOString().slice(0, 10);
  if (canonical !== value || value < "2020-01-01" || value > "2100-12-31") {
    fail(code);
  }
  return value;
}

function parseSetup(value: unknown, code: string): ShareableSetupResult {
  expectExactKeys(value, ["outcome", "durationMinutes"], code);
  const outcome = oneOf(
    value.outcome,
    ["success", "failure", "not_observed"] as const,
    code,
  );
  const durationMinutes =
    value.durationMinutes === null
      ? null
      : boundedInteger(value.durationMinutes, 0, 240, code);
  if ((outcome === "not_observed") !== (durationMinutes === null)) fail(code);
  return { outcome, durationMinutes };
}

function parseEpisode(value: unknown, code: string): ShareableEpisodeResult {
  expectExactKeys(value, ["outcome", "durationMinutes"], code);
  const outcome = oneOf(
    value.outcome,
    ["completed", "not_completed", "not_observed"] as const,
    code,
  );
  const durationMinutes =
    value.durationMinutes === null
      ? null
      : boundedInteger(value.durationMinutes, 0, 480, code);
  if ((outcome === "completed") !== (durationMinutes !== null)) fail(code);
  return { outcome, durationMinutes };
}

function parseStep(value: unknown, code: string): PilotStepObservation {
  expectExactKeys(value, ["outcome", "durationMinutes"], code);
  const outcome = oneOf(value.outcome, STEP_OUTCOMES, code);
  const durationMinutes =
    value.durationMinutes === null
      ? null
      : boundedInteger(value.durationMinutes, 0, 240, code);
  if ((outcome === "not_observed") !== (durationMinutes === null)) fail(code);
  return { outcome, durationMinutes };
}

export function parsePilotDistributionObservation(
  value: unknown,
  code: string,
): PilotDistributionObservation {
  expectExactKeys(
    value,
    [
      "download",
      "checksumVerification",
      "extraction",
      "firstLaunch",
      "timeToRoomMinutes",
      "failurePoint",
    ],
    code,
  );
  const download = parseStep(value.download, code);
  const checksumVerification = parseStep(value.checksumVerification, code);
  const extraction = parseStep(value.extraction, code);
  const firstLaunch = parseStep(value.firstLaunch, code);
  const timeToRoomMinutes =
    value.timeToRoomMinutes === null
      ? null
      : boundedInteger(value.timeToRoomMinutes, 0, 480, code);
  const failurePoint =
    value.failurePoint === null
      ? null
      : oneOf(value.failurePoint, PILOT_EXIT_POINTS, code);
  const steps = [download, checksumVerification, extraction, firstLaunch];
  if (
    (firstLaunch.outcome === "success") !== (timeToRoomMinutes !== null) ||
    (steps.some((step) => step.outcome === "failure") && failurePoint === null) ||
    (steps.every((step) => step.outcome === "success") && failurePoint !== null)
  ) {
    fail(code);
  }
  return {
    download,
    checksumVerification,
    extraction,
    firstLaunch,
    timeToRoomMinutes,
    failurePoint,
  };
}

export function parsePilotJourneyObservation(
  value: unknown,
  code: string,
): PilotJourneyObservation {
  expectExactKeys(
    value,
    [
      "project",
      "brief",
      "review",
      "manifest",
      "disposition",
      "receipt",
      "recovery",
      "relaunch",
    ],
    code,
  );
  return {
    project: oneOf(value.project, JOURNEY_OUTCOMES, code),
    brief: oneOf(value.brief, JOURNEY_OUTCOMES, code),
    review: oneOf(value.review, JOURNEY_OUTCOMES, code),
    manifest: oneOf(value.manifest, JOURNEY_OUTCOMES, code),
    disposition: oneOf(value.disposition, JOURNEY_OUTCOMES, code),
    receipt: oneOf(value.receipt, JOURNEY_OUTCOMES, code),
    recovery: oneOf(value.recovery, RECOVERY_OUTCOMES, code),
    relaunch: oneOf(value.relaunch, STEP_OUTCOMES, code),
  };
}

export function parseLocalWebLifecycleObservation(
  value: unknown,
  code: string,
): LocalWebLifecycleObservation {
  expectExactKeys(
    value,
    ["outcome", "frictionSeverity", "blocking"],
    code,
  );
  const outcome = oneOf(value.outcome, STEP_OUTCOMES, code);
  const frictionSeverity = oneOf(
    value.frictionSeverity,
    FRICTION_SEVERITIES,
    code,
  );
  const blocking = booleanValue(value.blocking, code);
  if (
    blocking !== (frictionSeverity === "blocking") ||
    (outcome === "not_observed" && frictionSeverity !== "none")
  ) {
    fail(code);
  }
  return { outcome, frictionSeverity, blocking };
}

function parseFindingCounts(
  value: unknown,
  code: string,
): FindingAssessmentCounts {
  expectExactKeys(value, ["necessary", "unnecessary", "uncertain"], code);
  const parsed = {
    necessary: boundedInteger(value.necessary, 0, 1_000, code),
    unnecessary: boundedInteger(value.unnecessary, 0, 1_000, code),
    uncertain: boundedInteger(value.uncertain, 0, 1_000, code),
  };
  if (parsed.necessary + parsed.unnecessary + parsed.uncertain > 1_000) {
    fail(code);
  }
  return parsed;
}

function parseBurden(
  value: unknown,
  code: string,
): MaintenanceBurdenScores {
  expectExactKeys(
    value,
    ["brief", "decision", "issue", "manifest", "recovery"],
    code,
  );
  return {
    brief: boundedInteger(value.brief, 1, 5, code) as BurdenScore,
    decision: boundedInteger(value.decision, 1, 5, code) as BurdenScore,
    issue: boundedInteger(value.issue, 1, 5, code) as BurdenScore,
    manifest: boundedInteger(value.manifest, 1, 5, code) as BurdenScore,
    recovery: boundedInteger(value.recovery, 1, 5, code) as BurdenScore,
  };
}

function parseUnsignedExport(
  value: unknown,
  code = "pilot_export_invalid",
): UnsignedShareablePilotExport {
  expectExactKeys(value, UNSIGNED_EXPORT_KEYS, code);
  if (value.schemaVersion !== SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION) fail(code);
  if (
    typeof value.participantCode !== "string" ||
    !/^(?=[A-Z0-9_-]*[A-Z])[A-Z0-9][A-Z0-9_-]{2,31}$/u.test(value.participantCode)
  ) {
    fail(code);
  }
  if (
    typeof value.sessionId !== "string" ||
    !/^ps_[a-f0-9]{32}$/u.test(value.sessionId)
  ) {
    fail(code);
  }
  if (
    typeof value.evidenceId !== "string" ||
    !/^pe_[a-f0-9]{24}$/u.test(value.evidenceId)
  ) {
    fail(code);
  }
  const sessionOrdinal = boundedInteger(value.sessionOrdinal, 1, 2, code) as
    | 1
    | 2;
  const participantRole = oneOf(value.participantRole, PARTICIPANT_ROLES, code);
  const hostEntry = oneOf(value.hostEntry, HOST_ENTRIES, code);
  const materialType = oneOf(value.materialType, MATERIAL_TYPES, code);
  const sessionDate = parseDate(value.sessionDate, code);
  const totalDurationMinutes = boundedInteger(
    value.totalDurationMinutes,
    0,
    1_440,
    code,
  );
  const releasePlatform = oneOf(
    value.releasePlatform,
    RELEASE_PLATFORMS,
    code,
  );
  const distributionSource = oneOf(
    value.distributionSource,
    DISTRIBUTION_SOURCES,
    code,
  );
  if (
    typeof value.releaseSourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.releaseSourceCommit) ||
    typeof value.releaseAssetSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.releaseAssetSha256)
  ) {
    fail(code);
  }
  const operatingMode = oneOf(value.operatingMode, OPERATING_MODES, code);
  const distribution = parsePilotDistributionObservation(
    value.distribution,
    code,
  );
  const journey = parsePilotJourneyObservation(value.journey, code);
  const localWebLifecycle = parseLocalWebLifecycleObservation(
    value.localWebLifecycle,
    code,
  );
  const setup = parseSetup(value.setup, code);
  const episode = parseEpisode(value.episode, code);
  const exitResult = oneOf(value.exitResult, SESSION_EXIT_RESULTS, code);
  const exitPoint =
    value.exitPoint === null
      ? null
      : oneOf(value.exitPoint, PILOT_EXIT_POINTS, code);
  const repeatCorrectionImpact = oneOf(
    value.repeatCorrectionImpact,
    REPEAT_CORRECTION_IMPACTS,
    code,
  );
  const findingAssessment = parseFindingCounts(value.findingAssessment, code);
  const maintenanceBurden = parseBurden(value.maintenanceBurden, code);
  const secondUseObserved = booleanValue(value.secondUseObserved, code);
  const preferredEntry = oneOf(value.preferredEntry, PREFERRED_ENTRIES, code);
  const desktopNeed = oneOf(value.desktopNeed, DESKTOP_NEEDS, code);
  const desktopSolutionEvidence = oneOf(
    value.desktopSolutionEvidence,
    DESKTOP_SOLUTION_EVIDENCE,
    code,
  );
  const uiNeed = oneOf(value.uiNeed, UI_NEEDS, code);
  const syntheticCaseDiscussion = oneOf(
    value.syntheticCaseDiscussion,
    SYNTHETIC_CASE_DISCUSSION_VALUES,
    code,
  );
  const wouldUseAgain = oneOf(
    value.wouldUseAgain,
    WOULD_USE_AGAIN_VALUES,
    code,
  );
  const failureObserved = booleanValue(value.failureObserved, code);
  const negativeFeedbackObserved = booleanValue(
    value.negativeFeedbackObserved,
    code,
  );
  if (
    value.consentVersion !== PILOT_CONSENT_VERSION ||
    value.protocolVersion !== PILOT_PROTOCOL_VERSION ||
    value.pilotKitVersion !== PILOT_KIT_VERSION
  ) {
    fail(code);
  }
  if (
    value.releaseVersion !== "0.2.0" ||
    value.releaseChannel !== "public_preview" ||
    typeof value.releaseBuildId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.releaseBuildId)
  ) {
    fail(code);
  }
  const durationFloor =
    (setup.durationMinutes ?? 0) + (episode.durationMinutes ?? 0);
  if (
    totalDurationMinutes < durationFloor ||
    secondUseObserved !== (sessionOrdinal === 2) ||
    ((exitResult === "completed") !== (exitPoint === null)) ||
    (setup.outcome === "failure" && !failureObserved) ||
    (distributionSource !== "github_release" &&
      participantRole === "external_researcher") ||
    (localWebLifecycle.blocking && !failureObserved) ||
    (desktopNeed === "required" &&
      desktopSolutionEvidence === "none") ||
    (exitResult === "completed" &&
      (setup.outcome !== "success" ||
        episode.outcome !== "completed" ||
        distribution.firstLaunch.outcome !== "success" ||
        journey.project !== "completed" ||
        journey.brief !== "completed" ||
        journey.review !== "completed" ||
        journey.manifest !== "completed" ||
        journey.disposition !== "completed" ||
        journey.receipt !== "completed" ||
        journey.relaunch !== "success"))
  ) {
    fail(code);
  }
  return {
    schemaVersion: SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION,
    participantCode: value.participantCode,
    sessionId: value.sessionId,
    evidenceId: value.evidenceId,
    sessionOrdinal,
    participantRole,
    hostEntry,
    materialType,
    sessionDate,
    totalDurationMinutes,
    releasePlatform,
    distributionSource,
    releaseSourceCommit: value.releaseSourceCommit,
    releaseAssetSha256: value.releaseAssetSha256,
    operatingMode,
    distribution,
    journey,
    localWebLifecycle,
    setup,
    episode,
    exitResult,
    exitPoint,
    repeatCorrectionImpact,
    findingAssessment,
    maintenanceBurden,
    secondUseObserved,
    preferredEntry,
    desktopNeed,
    desktopSolutionEvidence,
    uiNeed,
    syntheticCaseDiscussion,
    wouldUseAgain,
    failureObserved,
    negativeFeedbackObserved,
    consentVersion: PILOT_CONSENT_VERSION,
    protocolVersion: PILOT_PROTOCOL_VERSION,
    pilotKitVersion: PILOT_KIT_VERSION,
    releaseVersion: "0.2.0",
    releaseChannel: "public_preview",
    releaseBuildId: value.releaseBuildId,
  };
}

export function createShareablePilotExport(
  value: UnsignedShareablePilotExport,
): ShareablePilotExport {
  const parsed = parseUnsignedExport(value);
  const contentHash = sha256(canonicalStringify(parsed));
  return { ...parsed, contentHash };
}

export function parseShareablePilotExport(
  value: unknown,
): ShareablePilotExport {
  const code = "pilot_export_invalid";
  expectExactKeys(value, [...UNSIGNED_EXPORT_KEYS, "contentHash"], code);
  const { contentHash, ...unsigned } = value;
  if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(contentHash)) {
    fail(code);
  }
  const parsed = parseUnsignedExport(unsigned, code);
  if (sha256(canonicalStringify(parsed)) !== contentHash) fail(code);
  return { ...parsed, contentHash };
}
