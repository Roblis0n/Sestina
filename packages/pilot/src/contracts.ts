import { createHash } from "node:crypto";

export const PRIVATE_PILOT_SESSION_SCHEMA_VERSION = "1.0.0" as const;
export const SHAREABLE_PILOT_EXPORT_SCHEMA_VERSION = "1.0.0" as const;
export const PILOT_AGGREGATE_SCHEMA_VERSION = "1.0.0" as const;
export const PILOT_KIT_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;
export const PILOT_KIT_VERSION = "1.0.0" as const;
export const PILOT_PROTOCOL_VERSION = "2026-08-21" as const;
export const PILOT_CONSENT_VERSION = "2026-08-21" as const;

export const PARTICIPANT_ROLES = [
  "external_researcher",
  "project_owner",
  "internal_test",
] as const;
export const HOST_ENTRIES = ["cli", "mcp", "capsule", "multiple"] as const;
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
  "cli",
  "mcp",
  "capsule",
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
  "installation",
  "initialization",
  "connection",
  "brief",
  "episode",
  "review",
  "second_task",
  "other",
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
  readonly setup: ShareableSetupResult;
  readonly episode: ShareableEpisodeResult;
  readonly exitResult: SessionExitResult;
  readonly exitPoint: PilotExitPoint | null;
  readonly repeatCorrectionImpact: RepeatCorrectionImpact;
  readonly findingAssessment: FindingAssessmentCounts;
  readonly maintenanceBurden: MaintenanceBurdenScores;
  readonly secondUseObserved: boolean;
  readonly preferredEntry: PreferredEntry;
  readonly uiNeed: UiNeed;
  readonly syntheticCaseDiscussion: SyntheticCaseDiscussion;
  readonly wouldUseAgain: WouldUseAgain;
  readonly failureObserved: boolean;
  readonly negativeFeedbackObserved: boolean;
  readonly consentVersion: typeof PILOT_CONSENT_VERSION;
  readonly protocolVersion: typeof PILOT_PROTOCOL_VERSION;
  readonly pilotKitVersion: typeof PILOT_KIT_VERSION;
  readonly releaseVersion: string;
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
  "setup",
  "episode",
  "exitResult",
  "exitPoint",
  "repeatCorrectionImpact",
  "findingAssessment",
  "maintenanceBurden",
  "secondUseObserved",
  "preferredEntry",
  "uiNeed",
  "syntheticCaseDiscussion",
  "wouldUseAgain",
  "failureObserved",
  "negativeFeedbackObserved",
  "consentVersion",
  "protocolVersion",
  "pilotKitVersion",
  "releaseVersion",
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
  expectExactKeys(value, ["brief", "decision", "issue"], code);
  return {
    brief: boundedInteger(value.brief, 1, 5, code) as BurdenScore,
    decision: boundedInteger(value.decision, 1, 5, code) as BurdenScore,
    issue: boundedInteger(value.issue, 1, 5, code) as BurdenScore,
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
    typeof value.releaseVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.releaseVersion) ||
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
    (exitResult === "completed" &&
      (setup.outcome !== "success" || episode.outcome !== "completed"))
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
    setup,
    episode,
    exitResult,
    exitPoint,
    repeatCorrectionImpact,
    findingAssessment,
    maintenanceBurden,
    secondUseObserved,
    preferredEntry,
    uiNeed,
    syntheticCaseDiscussion,
    wouldUseAgain,
    failureObserved,
    negativeFeedbackObserved,
    consentVersion: PILOT_CONSENT_VERSION,
    protocolVersion: PILOT_PROTOCOL_VERSION,
    pilotKitVersion: PILOT_KIT_VERSION,
    releaseVersion: value.releaseVersion,
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
