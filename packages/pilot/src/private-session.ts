import {
  HOST_ENTRIES,
  MATERIAL_TYPES,
  PARTICIPANT_ROLES,
  PILOT_CONSENT_VERSION,
  PILOT_EXIT_POINTS,
  PILOT_KIT_VERSION,
  PILOT_PROTOCOL_VERSION,
  PREFERRED_ENTRIES,
  PRIVATE_PILOT_SESSION_SCHEMA_VERSION,
  REPEAT_CORRECTION_IMPACTS,
  SESSION_EXIT_RESULTS,
  SYNTHETIC_CASE_DISCUSSION_VALUES,
  UI_NEEDS,
  WOULD_USE_AGAIN_VALUES,
  canonicalStringify,
  createShareablePilotExport,
  expectExactKeys,
  sha256,
  type FindingAssessmentCounts,
  type HostEntry,
  type MaintenanceBurdenScores,
  type MaterialType,
  type ParticipantRole,
  type PilotExitPoint,
  type PreferredEntry,
  type RepeatCorrectionImpact,
  type SessionExitResult,
  type ShareableEpisodeResult,
  type ShareablePilotExport,
  type ShareableSetupResult,
  type SyntheticCaseDiscussion,
  type UiNeed,
  type WouldUseAgain,
} from "./contracts.js";

export const PILOT_CHECKPOINT_EVENTS = [
  "install_started",
  "install_succeeded",
  "install_failed",
  "initialization_succeeded",
  "initialization_failed",
  "connect_succeeded",
  "connect_exited",
  "brief_completed",
  "episode_started",
  "episode_completed",
  "review_completed",
  "participant_exited",
  "second_task_started",
  "second_task_completed",
] as const;

export type PilotCheckpointEvent = (typeof PILOT_CHECKPOINT_EVENTS)[number];
export { PILOT_EXIT_POINTS, type PilotExitPoint } from "./contracts.js";

export interface PilotCheckpoint {
  readonly event: PilotCheckpointEvent;
  readonly occurredAt: string;
  readonly exitPoint: PilotExitPoint | null;
}

const CHECKPOINT_PREREQUISITE: Readonly<
  Partial<Record<PilotCheckpointEvent, PilotCheckpointEvent>>
> = {
  install_succeeded: "install_started",
  install_failed: "install_started",
  initialization_succeeded: "install_succeeded",
  initialization_failed: "install_succeeded",
  episode_completed: "episode_started",
  second_task_completed: "second_task_started",
};

const CHECKPOINT_CONFLICTS: Readonly<
  Partial<Record<PilotCheckpointEvent, readonly PilotCheckpointEvent[]>>
> = {
  install_succeeded: ["install_failed"],
  install_failed: ["install_succeeded"],
  initialization_succeeded: ["initialization_failed"],
  initialization_failed: ["initialization_succeeded"],
};

export function isValidPilotCheckpointTransition(
  checkpoints: readonly PilotCheckpoint[],
  sessionOrdinal: 1 | 2,
  event: PilotCheckpointEvent,
  exitPoint: PilotExitPoint | null,
): boolean {
  const observed = new Set(checkpoints.map((item) => item.event));
  const prerequisite = CHECKPOINT_PREREQUISITE[event];
  if (
    observed.has(event) ||
    observed.has("participant_exited") ||
    (event.startsWith("second_task_") && sessionOrdinal !== 2) ||
    (prerequisite !== undefined && !observed.has(prerequisite)) ||
    (CHECKPOINT_CONFLICTS[event] ?? []).some((item) => observed.has(item))
  ) {
    return false;
  }
  if (event === "connect_exited") return exitPoint === "connection";
  if (event === "participant_exited") return exitPoint !== null;
  return exitPoint === null;
}

export interface PrivatePilotFinish {
  readonly finishedAt: string;
  readonly totalDurationMinutes: number;
  readonly setup: ShareableSetupResult;
  readonly episode: ShareableEpisodeResult;
  readonly exitResult: SessionExitResult;
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
}

export interface PrivatePilotSession {
  readonly schemaVersion: typeof PRIVATE_PILOT_SESSION_SCHEMA_VERSION;
  readonly participantCode: string;
  readonly sessionId: string;
  readonly evidenceId: string;
  readonly sessionOrdinal: 1 | 2;
  readonly participantRole: ParticipantRole;
  readonly hostEntry: HostEntry;
  readonly materialType: MaterialType;
  readonly consent: {
    readonly version: typeof PILOT_CONSENT_VERSION;
    readonly acknowledgedAt: string;
  };
  readonly protocolVersion: typeof PILOT_PROTOCOL_VERSION;
  readonly pilotKitVersion: typeof PILOT_KIT_VERSION;
  readonly releaseVersion: string;
  readonly releaseBuildId: string;
  readonly startedAt: string;
  readonly checkpoints: readonly PilotCheckpoint[];
  readonly finish: PrivatePilotFinish | null;
  readonly integrityHash: string;
}

export type UnsignedPrivatePilotSession = Omit<
  PrivatePilotSession,
  "integrityHash"
>;

const SESSION_KEYS = [
  "schemaVersion",
  "participantCode",
  "sessionId",
  "evidenceId",
  "sessionOrdinal",
  "participantRole",
  "hostEntry",
  "materialType",
  "consent",
  "protocolVersion",
  "pilotKitVersion",
  "releaseVersion",
  "releaseBuildId",
  "startedAt",
  "checkpoints",
  "finish",
] as const;

const FINISH_KEYS = [
  "finishedAt",
  "totalDurationMinutes",
  "setup",
  "episode",
  "exitResult",
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
] as const;

function fail(): never {
  throw new Error("pilot_session_invalid");
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail();
  return value as T;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    fail();
  }
  return value as number;
}

export function parsePilotTimestamp(value: unknown): string {
  if (typeof value !== "string") fail();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) fail();
  if (value < "2020-01-01T00:00:00.000Z" || value > "2100-12-31T23:59:59.999Z") {
    fail();
  }
  return value;
}

function parseCheckpoint(value: unknown): PilotCheckpoint {
  expectExactKeys(
    value,
    ["event", "occurredAt", "exitPoint"],
    "pilot_session_invalid",
  );
  return {
    event: oneOf(value.event, PILOT_CHECKPOINT_EVENTS),
    occurredAt: parsePilotTimestamp(value.occurredAt),
    exitPoint:
      value.exitPoint === null ? null : oneOf(value.exitPoint, PILOT_EXIT_POINTS),
  };
}

function parseSetup(value: unknown): ShareableSetupResult {
  expectExactKeys(
    value,
    ["outcome", "durationMinutes"],
    "pilot_session_invalid",
  );
  const outcome = oneOf(
    value.outcome,
    ["success", "failure", "not_observed"] as const,
  );
  const durationMinutes =
    value.durationMinutes === null
      ? null
      : integer(value.durationMinutes, 0, 240);
  if ((outcome === "not_observed") !== (durationMinutes === null)) fail();
  return { outcome, durationMinutes };
}

function parseEpisode(value: unknown): ShareableEpisodeResult {
  expectExactKeys(
    value,
    ["outcome", "durationMinutes"],
    "pilot_session_invalid",
  );
  const outcome = oneOf(
    value.outcome,
    ["completed", "not_completed", "not_observed"] as const,
  );
  const durationMinutes =
    value.durationMinutes === null
      ? null
      : integer(value.durationMinutes, 0, 480);
  if ((outcome === "completed") !== (durationMinutes !== null)) fail();
  return { outcome, durationMinutes };
}

function parseCounts(value: unknown): FindingAssessmentCounts {
  expectExactKeys(
    value,
    ["necessary", "unnecessary", "uncertain"],
    "pilot_session_invalid",
  );
  const result = {
    necessary: integer(value.necessary, 0, 1_000),
    unnecessary: integer(value.unnecessary, 0, 1_000),
    uncertain: integer(value.uncertain, 0, 1_000),
  };
  if (result.necessary + result.unnecessary + result.uncertain > 1_000) fail();
  return result;
}

function parseBurden(value: unknown): MaintenanceBurdenScores {
  expectExactKeys(
    value,
    ["brief", "decision", "issue"],
    "pilot_session_invalid",
  );
  return {
    brief: integer(value.brief, 1, 5) as 1 | 2 | 3 | 4 | 5,
    decision: integer(value.decision, 1, 5) as 1 | 2 | 3 | 4 | 5,
    issue: integer(value.issue, 1, 5) as 1 | 2 | 3 | 4 | 5,
  };
}

function parseFinish(value: unknown): PrivatePilotFinish {
  expectExactKeys(value, FINISH_KEYS, "pilot_session_invalid");
  if (
    typeof value.secondUseObserved !== "boolean" ||
    typeof value.failureObserved !== "boolean" ||
    typeof value.negativeFeedbackObserved !== "boolean"
  ) {
    fail();
  }
  return {
    finishedAt: parsePilotTimestamp(value.finishedAt),
    totalDurationMinutes: integer(value.totalDurationMinutes, 0, 1_440),
    setup: parseSetup(value.setup),
    episode: parseEpisode(value.episode),
    exitResult: oneOf(value.exitResult, SESSION_EXIT_RESULTS),
    repeatCorrectionImpact: oneOf(
      value.repeatCorrectionImpact,
      REPEAT_CORRECTION_IMPACTS,
    ),
    findingAssessment: parseCounts(value.findingAssessment),
    maintenanceBurden: parseBurden(value.maintenanceBurden),
    secondUseObserved: value.secondUseObserved,
    preferredEntry: oneOf(value.preferredEntry, PREFERRED_ENTRIES),
    uiNeed: oneOf(value.uiNeed, UI_NEEDS),
    syntheticCaseDiscussion: oneOf(
      value.syntheticCaseDiscussion,
      SYNTHETIC_CASE_DISCUSSION_VALUES,
    ),
    wouldUseAgain: oneOf(value.wouldUseAgain, WOULD_USE_AGAIN_VALUES),
    failureObserved: value.failureObserved,
    negativeFeedbackObserved: value.negativeFeedbackObserved,
  };
}

function parseUnsignedPrivate(value: unknown): UnsignedPrivatePilotSession {
  expectExactKeys(value, SESSION_KEYS, "pilot_session_invalid");
  if (
    value.schemaVersion !== PRIVATE_PILOT_SESSION_SCHEMA_VERSION ||
    typeof value.participantCode !== "string" ||
    !/^(?=[A-Z0-9_-]*[A-Z])[A-Z0-9][A-Z0-9_-]{2,31}$/u.test(value.participantCode) ||
    typeof value.sessionId !== "string" ||
    !/^ps_[a-f0-9]{32}$/u.test(value.sessionId) ||
    typeof value.evidenceId !== "string" ||
    !/^pe_[a-f0-9]{24}$/u.test(value.evidenceId)
  ) {
    fail();
  }
  const sessionOrdinal = integer(value.sessionOrdinal, 1, 2) as 1 | 2;
  const participantRole = oneOf(value.participantRole, PARTICIPANT_ROLES);
  const hostEntry = oneOf(value.hostEntry, HOST_ENTRIES);
  const materialType = oneOf(value.materialType, MATERIAL_TYPES);
  expectExactKeys(
    value.consent,
    ["version", "acknowledgedAt"],
    "pilot_session_invalid",
  );
  if (value.consent.version !== PILOT_CONSENT_VERSION) fail();
  const consent = {
    version: PILOT_CONSENT_VERSION,
    acknowledgedAt: parsePilotTimestamp(value.consent.acknowledgedAt),
  };
  if (
    value.protocolVersion !== PILOT_PROTOCOL_VERSION ||
    value.pilotKitVersion !== PILOT_KIT_VERSION ||
    typeof value.releaseVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.releaseVersion) ||
    typeof value.releaseBuildId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.releaseBuildId) ||
    !Array.isArray(value.checkpoints) ||
    value.checkpoints.length > 100
  ) {
    fail();
  }
  const startedAt = parsePilotTimestamp(value.startedAt);
  const checkpoints = value.checkpoints.map(parseCheckpoint);
  const validatedCheckpoints: PilotCheckpoint[] = [];
  let priorTime = Date.parse(startedAt);
  for (const checkpoint of checkpoints) {
    const time = Date.parse(checkpoint.occurredAt);
    if (
      time < priorTime ||
      !isValidPilotCheckpointTransition(
        validatedCheckpoints,
        sessionOrdinal,
        checkpoint.event,
        checkpoint.exitPoint,
      )
    ) {
      fail();
    }
    validatedCheckpoints.push(checkpoint);
    priorTime = time;
  }
  const finish = value.finish === null ? null : parseFinish(value.finish);
  if (finish !== null && Date.parse(finish.finishedAt) < priorTime) fail();
  return {
    schemaVersion: PRIVATE_PILOT_SESSION_SCHEMA_VERSION,
    participantCode: value.participantCode,
    sessionId: value.sessionId,
    evidenceId: value.evidenceId,
    sessionOrdinal,
    participantRole,
    hostEntry,
    materialType,
    consent,
    protocolVersion: PILOT_PROTOCOL_VERSION,
    pilotKitVersion: PILOT_KIT_VERSION,
    releaseVersion: value.releaseVersion,
    releaseBuildId: value.releaseBuildId,
    startedAt,
    checkpoints,
    finish,
  };
}

export function signPrivatePilotSession(
  value: UnsignedPrivatePilotSession,
): PrivatePilotSession {
  const parsed = parseUnsignedPrivate(value);
  return {
    ...parsed,
    integrityHash: sha256(canonicalStringify(parsed)),
  };
}

export function parsePrivatePilotSession(value: unknown): PrivatePilotSession {
  expectExactKeys(
    value,
    [...SESSION_KEYS, "integrityHash"],
    "pilot_session_invalid",
  );
  const { integrityHash, ...unsigned } = value;
  if (
    typeof integrityHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(integrityHash)
  ) {
    fail();
  }
  const parsed = parseUnsignedPrivate(unsigned);
  if (sha256(canonicalStringify(parsed)) !== integrityHash) fail();
  if (parsed.finish !== null) {
    try {
      createShareablePilotExport(projectShareablePilotExport(parsed));
    } catch {
      fail();
    }
  }
  return { ...parsed, integrityHash };
}

export function projectShareablePilotExport(
  session: UnsignedPrivatePilotSession,
): Omit<ShareablePilotExport, "contentHash"> {
  if (session.finish === null) throw new Error("pilot_session_not_finished");
  const finish = session.finish;
  const exitPoint =
    session.checkpoints
      .toReversed()
      .find((checkpoint) => checkpoint.exitPoint !== null)?.exitPoint ?? null;
  return {
    schemaVersion: "1.0.0",
    participantCode: session.participantCode,
    sessionId: session.sessionId,
    evidenceId: session.evidenceId,
    sessionOrdinal: session.sessionOrdinal,
    participantRole: session.participantRole,
    hostEntry: session.hostEntry,
    materialType: session.materialType,
    sessionDate: session.startedAt.slice(0, 10),
    totalDurationMinutes: finish.totalDurationMinutes,
    setup: finish.setup,
    episode: finish.episode,
    exitResult: finish.exitResult,
    exitPoint,
    repeatCorrectionImpact: finish.repeatCorrectionImpact,
    findingAssessment: finish.findingAssessment,
    maintenanceBurden: finish.maintenanceBurden,
    secondUseObserved: finish.secondUseObserved,
    preferredEntry: finish.preferredEntry,
    uiNeed: finish.uiNeed,
    syntheticCaseDiscussion: finish.syntheticCaseDiscussion,
    wouldUseAgain: finish.wouldUseAgain,
    failureObserved: finish.failureObserved,
    negativeFeedbackObserved: finish.negativeFeedbackObserved,
    consentVersion: session.consent.version,
    protocolVersion: session.protocolVersion,
    pilotKitVersion: session.pilotKitVersion,
    releaseVersion: session.releaseVersion,
    releaseBuildId: session.releaseBuildId,
  };
}
