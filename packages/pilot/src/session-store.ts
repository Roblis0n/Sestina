import { randomBytes } from "node:crypto";
import {
  constants,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  PILOT_CONSENT_VERSION,
  PILOT_KIT_VERSION,
  PILOT_PROTOCOL_VERSION,
  canonicalStringify,
  createShareablePilotExport,
  sha256,
  type FindingAssessmentCounts,
  type HostEntry,
  type MaintenanceBurdenScores,
  type MaterialType,
  type ParticipantRole,
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
import {
  PILOT_CHECKPOINT_EVENTS,
  PILOT_EXIT_POINTS,
  isValidPilotCheckpointTransition,
  parsePilotTimestamp,
  parsePrivatePilotSession,
  projectShareablePilotExport,
  signPrivatePilotSession,
  type PilotCheckpoint,
  type PilotCheckpointEvent,
  type PilotExitPoint,
  type PrivatePilotFinish,
  type PrivatePilotSession,
  type UnsignedPrivatePilotSession,
} from "./private-session.js";

function stableError(code: string): Error {
  return new Error(code);
}

function unsignedSession(
  session: PrivatePilotSession,
): UnsignedPrivatePilotSession {
  return Object.fromEntries(
    Object.entries(session).filter(([key]) => key !== "integrityHash"),
  ) as unknown as UnsignedPrivatePilotSession;
}

function validateId(value: string, kind: "session" | "evidence"): void {
  const valid =
    kind === "session"
      ? /^ps_[a-f0-9]{32}$/u.test(value)
      : /^pe_[a-f0-9]{24}$/u.test(value);
  if (!valid) throw stableError("pilot_session_invalid");
}

function normalizeForComparison(value: string): string {
  const normalized = normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertNoUnsafeExistingComponent(path: string): void {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  const pieces = relative(root, resolved).split(sep).filter(Boolean);
  let current = root;
  for (const piece of pieces) {
    current = join(current, piece);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && current !== resolved)) {
        throw stableError("pilot_private_root_unsafe");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        break;
      }
      throw error;
    }
  }
}

async function safePrivateRoot(
  input: string,
  create: boolean,
): Promise<string> {
  if (
    !isAbsolute(input) ||
    input.includes("\0") ||
    input.split(/[\\/]+/u).some((part) => part === "." || part === "..") ||
    normalizeForComparison(input) !== normalizeForComparison(resolve(input))
  ) {
    throw stableError("pilot_private_root_unsafe");
  }
  assertNoUnsafeExistingComponent(input);
  if (create) await mkdir(input, { recursive: true, mode: 0o700 });
  let stat;
  try {
    stat = lstatSync(input);
  } catch {
    throw stableError("pilot_private_root_invalid");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw stableError("pilot_private_root_unsafe");
  }
  const canonical = realpathSync.native(input);
  if (normalizeForComparison(canonical) !== normalizeForComparison(resolve(input))) {
    throw stableError("pilot_private_root_unsafe");
  }
  return canonical;
}

function assertRegularFile(path: string, code: string): void {
  try {
    const value = lstatSync(path);
    if (!value.isFile() || value.isSymbolicLink()) throw stableError(code);
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw stableError(code);
  }
}

function sessionPath(root: string, sessionId: string): string {
  validateId(sessionId, "session");
  const result = join(root, `${sessionId}.json`);
  if (dirname(result) !== root) throw stableError("pilot_session_invalid");
  return result;
}

async function readSession(
  privateRoot: string,
  sessionId: string,
): Promise<{ root: string; path: string; session: PrivatePilotSession }> {
  const root = await safePrivateRoot(privateRoot, false);
  const path = sessionPath(root, sessionId);
  assertRegularFile(path, "pilot_session_not_found");
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    return { root, path, session: parsePrivatePilotSession(raw) };
  } catch (error) {
    if (
      error instanceof Error &&
      ["pilot_session_not_found", "pilot_session_invalid"].includes(error.message)
    ) {
      throw error;
    }
    throw stableError("pilot_session_invalid");
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temp = join(
    dirname(path),
    `.pilot-tmp-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  try {
    await writeFile(temp, `${canonicalStringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, path);
  } catch {
    await rm(temp, { force: true });
    throw stableError("pilot_write_failed");
  }
}

async function withSessionLock<T>(
  root: string,
  sessionId: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = join(root, `${sessionId}.lock`);
  let handle;
  try {
    handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch {
    throw stableError("pilot_session_busy");
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

function nowTimestamp(at?: string): string {
  return parsePilotTimestamp(at ?? new Date().toISOString());
}

function minutesBetween(start: string, end: string, maximum: number): number {
  const milliseconds = Date.parse(end) - Date.parse(start);
  if (milliseconds < 0) throw stableError("pilot_session_invalid");
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes > maximum) throw stableError("pilot_session_invalid");
  return minutes;
}

function eventTime(
  checkpoints: readonly PilotCheckpoint[],
  event: PilotCheckpointEvent,
): string | undefined {
  return checkpoints.find((checkpoint) => checkpoint.event === event)?.occurredAt;
}

function deriveSetup(
  session: PrivatePilotSession,
  finishedAt: string,
): ShareableSetupResult {
  const start = eventTime(session.checkpoints, "install_started") ?? session.startedAt;
  const success = eventTime(session.checkpoints, "initialization_succeeded");
  const failure =
    eventTime(session.checkpoints, "install_failed") ??
    eventTime(session.checkpoints, "initialization_failed");
  if (success !== undefined && (failure === undefined || success < failure)) {
    return {
      outcome: "success",
      durationMinutes: minutesBetween(start, success, 240),
    };
  }
  if (failure !== undefined) {
    return {
      outcome: "failure",
      durationMinutes: minutesBetween(start, failure, 240),
    };
  }
  if (finishedAt < start) throw stableError("pilot_session_invalid");
  return { outcome: "not_observed", durationMinutes: null };
}

function deriveEpisode(session: PrivatePilotSession): ShareableEpisodeResult {
  const start = eventTime(session.checkpoints, "episode_started");
  const complete = eventTime(session.checkpoints, "episode_completed");
  if (complete !== undefined) {
    if (start === undefined) throw stableError("pilot_session_invalid");
    return {
      outcome: "completed",
      durationMinutes: minutesBetween(start, complete, 480),
    };
  }
  return {
    outcome: start === undefined ? "not_observed" : "not_completed",
    durationMinutes: null,
  };
}

export interface StartPilotSessionInput {
  readonly privateRoot: string;
  readonly participantCode?: string;
  readonly sessionId?: string;
  readonly evidenceId?: string;
  readonly sessionOrdinal: 1 | 2;
  readonly participantRole: ParticipantRole;
  readonly hostEntry: HostEntry;
  readonly materialType: MaterialType;
  readonly consentVersion: string;
  readonly consentAcknowledged: boolean;
  readonly releaseVersion: string;
  readonly releaseBuildId: string;
  readonly at?: string;
}

export async function startPilotSession(
  input: StartPilotSessionInput,
): Promise<PrivatePilotSession> {
  if (
    !input.consentAcknowledged ||
    input.consentVersion !== PILOT_CONSENT_VERSION
  ) {
    throw stableError("pilot_consent_required");
  }
  const participantCode =
    input.participantCode ?? `P-${randomBytes(6).toString("hex").toUpperCase()}`;
  const sessionId = input.sessionId ?? `ps_${randomBytes(16).toString("hex")}`;
  validateId(sessionId, "session");
  const evidenceId =
    input.evidenceId ??
    `pe_${sha256(`${sessionId}:${participantCode}`).slice(0, 24)}`;
  validateId(evidenceId, "evidence");
  const at = nowTimestamp(input.at);
  const session = signPrivatePilotSession({
    schemaVersion: "1.0.0",
    participantCode,
    sessionId,
    evidenceId,
    sessionOrdinal: input.sessionOrdinal,
    participantRole: input.participantRole,
    hostEntry: input.hostEntry,
    materialType: input.materialType,
    consent: { version: PILOT_CONSENT_VERSION, acknowledgedAt: at },
    protocolVersion: PILOT_PROTOCOL_VERSION,
    pilotKitVersion: PILOT_KIT_VERSION,
    releaseVersion: input.releaseVersion,
    releaseBuildId: input.releaseBuildId,
    startedAt: at,
    checkpoints: [],
    finish: null,
  });
  const root = await safePrivateRoot(input.privateRoot, true);
  const path = sessionPath(root, sessionId);
  const startLockPath = join(root, ".pilot-start.lock");
  let startLock;
  try {
    startLock = await open(startLockPath, "wx", 0o600);
  } catch {
    throw stableError("pilot_session_busy");
  }
  try {
    const names = (await readdir(root)).filter((name) =>
      /^ps_[a-f0-9]{32}\.json$/u.test(name),
    );
    for (const name of names) {
      try {
        const existing = parsePrivatePilotSession(
          JSON.parse(await readFile(join(root, name), "utf8")) as unknown,
        );
        if (
          existing.participantCode === participantCode &&
          existing.sessionOrdinal === input.sessionOrdinal
        ) {
          throw stableError("pilot_session_ordinal_conflict");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "pilot_session_ordinal_conflict"
        ) {
          throw error;
        }
        throw stableError("pilot_session_invalid");
      }
    }
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${canonicalStringify(session)}\n`, "utf8");
      } finally {
        await handle.close();
      }
    } catch {
      throw stableError("pilot_session_exists");
    }
  } finally {
    await startLock.close();
    await rm(startLockPath, { force: true });
  }
  return session;
}

export interface CheckpointPilotSessionInput {
  readonly privateRoot: string;
  readonly sessionId: string;
  readonly event: PilotCheckpointEvent;
  readonly exitPoint: PilotExitPoint | null;
  readonly at?: string;
}

export async function checkpointPilotSession(
  input: CheckpointPilotSessionInput,
): Promise<PrivatePilotSession> {
  if (!PILOT_CHECKPOINT_EVENTS.includes(input.event)) {
    throw stableError("pilot_checkpoint_invalid");
  }
  if (
    input.exitPoint !== null &&
    !PILOT_EXIT_POINTS.includes(input.exitPoint)
  ) {
    throw stableError("pilot_checkpoint_invalid");
  }
  const initial = await readSession(input.privateRoot, input.sessionId);
  return withSessionLock(initial.root, input.sessionId, async () => {
    const current = (await readSession(initial.root, input.sessionId)).session;
    if (current.finish !== null) throw stableError("pilot_session_finished");
    if (current.checkpoints.some((item) => item.event === input.event)) {
      throw stableError("pilot_checkpoint_duplicate");
    }
    if (
      !isValidPilotCheckpointTransition(
        current.checkpoints,
        current.sessionOrdinal,
        input.event,
        input.exitPoint,
      )
    ) {
      throw stableError("pilot_checkpoint_invalid");
    }
    const occurredAt = nowTimestamp(input.at);
    const prior = current.checkpoints.at(-1)?.occurredAt ?? current.startedAt;
    if (occurredAt < prior) throw stableError("pilot_checkpoint_invalid");
    const checkpoint: PilotCheckpoint = {
      event: input.event,
      occurredAt,
      exitPoint: input.exitPoint,
    };
    const updated = signPrivatePilotSession({
      ...unsignedSession(current),
      checkpoints: [...current.checkpoints, checkpoint],
    });
    await atomicWrite(initial.path, updated);
    return updated;
  });
}

export interface FinishPilotSessionInput {
  readonly privateRoot: string;
  readonly sessionId: string;
  readonly at?: string;
  readonly exitResult: SessionExitResult;
  readonly repeatCorrectionImpact: RepeatCorrectionImpact;
  readonly findingAssessment: FindingAssessmentCounts;
  readonly maintenanceBurden: MaintenanceBurdenScores;
  readonly preferredEntry: PreferredEntry;
  readonly uiNeed: UiNeed;
  readonly syntheticCaseDiscussion: SyntheticCaseDiscussion;
  readonly wouldUseAgain: WouldUseAgain;
  readonly failureObserved: boolean;
  readonly negativeFeedbackObserved: boolean;
}

export async function finishPilotSession(
  input: FinishPilotSessionInput,
): Promise<PrivatePilotSession> {
  const initial = await readSession(input.privateRoot, input.sessionId);
  return withSessionLock(initial.root, input.sessionId, async () => {
    const current = (await readSession(initial.root, input.sessionId)).session;
    if (current.finish !== null) throw stableError("pilot_session_finished");
    const finishedAt = nowTimestamp(input.at);
    const prior = current.checkpoints.at(-1)?.occurredAt ?? current.startedAt;
    if (finishedAt < prior) throw stableError("pilot_session_invalid");
    const setup = deriveSetup(current, finishedAt);
    const episode = deriveEpisode(current);
    const checkpointFailure = current.checkpoints.some((checkpoint) =>
      ["install_failed", "initialization_failed", "connect_exited"].includes(
        checkpoint.event,
      ),
    );
    const secondUseObserved =
      current.sessionOrdinal === 2 &&
      current.checkpoints.some(
        (checkpoint) => checkpoint.event === "second_task_started",
      );
    const finish: PrivatePilotFinish = {
      finishedAt,
      totalDurationMinutes: minutesBetween(
        current.startedAt,
        finishedAt,
        1_440,
      ),
      setup,
      episode,
      exitResult: input.exitResult,
      repeatCorrectionImpact: input.repeatCorrectionImpact,
      findingAssessment: input.findingAssessment,
      maintenanceBurden: input.maintenanceBurden,
      secondUseObserved,
      preferredEntry: input.preferredEntry,
      uiNeed: input.uiNeed,
      syntheticCaseDiscussion: input.syntheticCaseDiscussion,
      wouldUseAgain: input.wouldUseAgain,
      failureObserved: input.failureObserved || checkpointFailure,
      negativeFeedbackObserved: input.negativeFeedbackObserved,
    };
    const updated = signPrivatePilotSession({
      ...unsignedSession(current),
      finish,
    });
    createShareablePilotExport(projectShareablePilotExport(updated));
    await atomicWrite(initial.path, updated);
    return updated;
  });
}

export async function showPilotSession(input: {
  readonly privateRoot: string;
  readonly sessionId: string;
}): Promise<PrivatePilotSession> {
  return (await readSession(input.privateRoot, input.sessionId)).session;
}

export async function deletePilotSession(input: {
  readonly privateRoot: string;
  readonly sessionId: string;
}): Promise<void> {
  const initial = await readSession(input.privateRoot, input.sessionId);
  await withSessionLock(initial.root, input.sessionId, async () => {
    const current = await readSession(initial.root, input.sessionId);
    if (current.path !== initial.path) throw stableError("pilot_session_invalid");
    await unlink(initial.path);
  });
}

async function safeShareableOutput(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) {
    throw stableError("pilot_export_path_invalid");
  }
  const resolved = resolve(path);
  const segments = resolved.split(/[\\/]+/u).map((value) => value.toLowerCase());
  if (segments.includes(".sestina") || segments.includes("pilot-private")) {
    throw stableError("pilot_export_path_invalid");
  }
  assertNoUnsafeExistingComponent(dirname(resolved));
  await mkdir(dirname(resolved), { recursive: true, mode: 0o700 });
  if (
    realpathSync.native(dirname(resolved)).toLowerCase() !==
    resolve(dirname(resolved)).toLowerCase()
  ) {
    throw stableError("pilot_export_path_invalid");
  }
  try {
    statSync(resolved);
    assertRegularFile(resolved, "pilot_export_path_invalid");
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) &&
      !(error instanceof Error && error.message === "pilot_export_path_invalid")
    ) {
      throw stableError("pilot_export_path_invalid");
    }
    if (error instanceof Error && error.message === "pilot_export_path_invalid") {
      throw error;
    }
  }
  return resolved;
}

export async function exportPilotSession(input: {
  readonly privateRoot: string;
  readonly sessionId: string;
  readonly exportPath: string;
}): Promise<ShareablePilotExport> {
  const session = (await readSession(input.privateRoot, input.sessionId)).session;
  const exported = createShareablePilotExport(
    projectShareablePilotExport(session),
  );
  const output = await safeShareableOutput(input.exportPath);
  await atomicWrite(output, exported);
  return exported;
}
