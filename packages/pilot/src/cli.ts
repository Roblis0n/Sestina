import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";

import { aggregatePilotExportDirectory } from "./aggregate-files.js";
import {
  DESKTOP_NEEDS,
  DESKTOP_SOLUTION_EVIDENCE,
  DISTRIBUTION_SOURCES,
  FRICTION_SEVERITIES,
  HOST_ENTRIES,
  JOURNEY_OUTCOMES,
  MATERIAL_TYPES,
  OPERATING_MODES,
  PARTICIPANT_ROLES,
  PILOT_CONSENT_VERSION,
  PREFERRED_ENTRIES,
  RECOVERY_OUTCOMES,
  RELEASE_PLATFORMS,
  REPEAT_CORRECTION_IMPACTS,
  SESSION_EXIT_RESULTS,
  STEP_OUTCOMES,
  SYNTHETIC_CASE_DISCUSSION_VALUES,
  UI_NEEDS,
  WOULD_USE_AGAIN_VALUES,
  canonicalStringify,
  isRecord,
  type BurdenScore,
  type FindingAssessmentCounts,
  type LocalWebLifecycleObservation,
  type MaintenanceBurdenScores,
  type PilotDistributionObservation,
  type PilotJourneyObservation,
} from "./contracts.js";
import {
  PILOT_CHECKPOINT_EVENTS,
  PILOT_EXIT_POINTS,
} from "./private-session.js";
import { verifyPilotKit } from "./kit.js";
import {
  checkpointPilotSession,
  deletePilotSession,
  exportPilotSession,
  finishPilotSession,
  showPilotSession,
  startPilotSession,
} from "./session-store.js";

export interface PilotCliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const DEFAULT_IO: PilotCliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

interface ParsedArguments {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string>>;
}

function parseArguments(args: readonly string[]): ParsedArguments | undefined {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) return undefined;
    if (!value.startsWith("--")) {
      if (Object.keys(options).length > 0) return undefined;
      positionals.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = args[index + 1];
    if (
      !/^[a-z][a-z0-9-]*$/u.test(name) ||
      next === undefined ||
      next.startsWith("--") ||
      Object.hasOwn(options, name)
    ) {
      return undefined;
    }
    options[name] = next;
    index += 1;
  }
  return { positionals, options };
}

function exactOptions(
  options: Readonly<Record<string, string>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(options, key)) &&
    Object.keys(options).every((key) => allowed.has(key))
  );
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value !== undefined && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function integer(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function nullableInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | null | undefined {
  return value === "none" ? null : integer(value, minimum, maximum);
}

function boolean(value: string | undefined): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

function output(io: PilotCliIo, value: unknown): void {
  io.stdout(`${canonicalStringify(value)}\n`);
}

const PUBLIC_ERROR_CODES = new Set([
  "pilot_consent_required",
  "pilot_session_not_found",
  "pilot_session_exists",
  "pilot_session_ordinal_conflict",
  "pilot_session_busy",
  "pilot_session_finished",
  "pilot_checkpoint_duplicate",
  "pilot_session_not_finished",
  "pilot_aggregate_conflict",
  "pilot_export_invalid",
  "pilot_aggregate_input_invalid",
  "pilot_output_write_failed",
  "pilot_write_failed",
  "pilot_kit_root_invalid",
  "pilot_kit_unsafe_path",
  "pilot_kit_manifest_invalid",
  "pilot_kit_case_collision",
  "pilot_kit_extra_file",
  "pilot_kit_missing_file",
  "pilot_kit_hash_mismatch",
  "pilot_kit_sums_invalid",
]);

function errorOutput(io: PilotCliIo, error: unknown): 1 | 2 {
  const raw = error instanceof Error ? error.message : "";
  const code = PUBLIC_ERROR_CODES.has(raw) ? raw : "pilot_input_invalid";
  io.stderr(`${canonicalStringify({ ok: false, error: code })}\n`);
  return code === "pilot_input_invalid" ? 2 : 1;
}

function releaseIdentityFromExecutable(path: string): {
  readonly releaseVersion: string;
  readonly releaseBuildId: string;
} {
  if (!isAbsolute(path)) throw new Error("pilot_input_invalid");
  const result = spawnSync(path, ["--version", "--json"], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 10_000,
    maxBuffer: 65_536,
  });
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error("pilot_sestina_identity_unavailable");
  }
  try {
    const value = JSON.parse(result.stdout) as unknown;
    if (
      !isRecord(value) ||
      typeof value.version !== "string" ||
      typeof value.releaseBuildId !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.version) ||
      !/^[a-f0-9]{64}$/u.test(value.releaseBuildId)
    ) {
      throw new Error("pilot_sestina_identity_unavailable");
    }
    return {
      releaseVersion: value.version,
      releaseBuildId: value.releaseBuildId,
    };
  } catch {
    throw new Error("pilot_sestina_identity_unavailable");
  }
}

function directReleaseIdentity(options: Readonly<Record<string, string>>): {
  readonly releaseVersion: string;
  readonly releaseBuildId: string;
} | undefined {
  const releaseVersion = options["release-version"];
  const releaseBuildId = options["release-build-id"];
  if (
    releaseVersion === undefined ||
    releaseBuildId === undefined ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(releaseVersion) ||
    !/^[a-f0-9]{64}$/u.test(releaseBuildId)
  ) {
    return undefined;
  }
  return { releaseVersion, releaseBuildId };
}

async function runSessionCommand(
  parsed: ParsedArguments,
  io: PilotCliIo,
): Promise<0 | 1 | 2> {
  const action = parsed.positionals[1];
  const options = parsed.options;
  if (action === "start" && parsed.positionals.length === 2) {
    const required = [
      "private-root",
      "session-ordinal",
      "participant-role",
      "host-entry",
      "material-type",
      "consent-version",
      "consent-acknowledged",
      "release-channel",
      "release-platform",
      "distribution-source",
      "release-source-commit",
      "release-asset-sha256",
      "operating-mode",
    ];
    const optional = [
      "participant-code",
      "session-id",
      "evidence-id",
      "release-version",
      "release-build-id",
      "sestina-bin",
      "at",
    ];
    if (!exactOptions(options, required, optional)) {
      throw new Error("pilot_input_invalid");
    }
    const ordinal = integer(options["session-ordinal"], 1, 2) as
      | 1
      | 2
      | undefined;
    const participantRole = oneOf(
      options["participant-role"],
      PARTICIPANT_ROLES,
    );
    const hostEntry = oneOf(options["host-entry"], HOST_ENTRIES);
    const materialType = oneOf(options["material-type"], MATERIAL_TYPES);
    const consentAcknowledged = boolean(options["consent-acknowledged"]);
    const releasePlatform = oneOf(
      options["release-platform"],
      RELEASE_PLATFORMS,
    );
    const distributionSource = oneOf(
      options["distribution-source"],
      DISTRIBUTION_SOURCES,
    );
    const operatingMode = oneOf(options["operating-mode"], OPERATING_MODES);
    const executable = options["sestina-bin"];
    if (
      ordinal === undefined ||
      participantRole === undefined ||
      hostEntry === undefined ||
      materialType === undefined ||
      consentAcknowledged === undefined ||
      options["release-channel"] !== "public_preview" ||
      releasePlatform === undefined ||
      distributionSource === undefined ||
      operatingMode === undefined ||
      !/^[a-f0-9]{40}$/u.test(options["release-source-commit"] ?? "") ||
      !/^[a-f0-9]{64}$/u.test(options["release-asset-sha256"] ?? "") ||
      options["consent-version"] !== PILOT_CONSENT_VERSION ||
      (executable !== undefined &&
        (options["release-version"] !== undefined ||
          options["release-build-id"] !== undefined))
    ) {
      throw new Error("pilot_input_invalid");
    }
    const identity =
      executable === undefined
        ? directReleaseIdentity(options)
        : releaseIdentityFromExecutable(executable);
    if (identity === undefined) throw new Error("pilot_input_invalid");
    const session = await startPilotSession({
      privateRoot: options["private-root"] ?? "",
      ...(options["participant-code"] === undefined
        ? {}
        : { participantCode: options["participant-code"] }),
      ...(options["session-id"] === undefined
        ? {}
        : { sessionId: options["session-id"] }),
      ...(options["evidence-id"] === undefined
        ? {}
        : { evidenceId: options["evidence-id"] }),
      sessionOrdinal: ordinal,
      participantRole,
      hostEntry,
      materialType,
      consentVersion: options["consent-version"] ?? "",
      consentAcknowledged,
      ...identity,
      releaseChannel: "public_preview",
      releasePlatform,
      distributionSource,
      releaseSourceCommit: options["release-source-commit"] ?? "",
      releaseAssetSha256: options["release-asset-sha256"] ?? "",
      operatingMode,
      ...(options.at === undefined ? {} : { at: options.at }),
    });
    output(io, {
      ok: true,
      command: "session_start",
      participantCode: session.participantCode,
      sessionId: session.sessionId,
      evidenceId: session.evidenceId,
    });
    return 0;
  }
  if (action === "checkpoint" && parsed.positionals.length === 2) {
    if (
      !exactOptions(
        options,
        ["private-root", "session-id", "event", "exit-point"],
        ["at"],
      )
    ) {
      throw new Error("pilot_input_invalid");
    }
    const event = oneOf(options.event, PILOT_CHECKPOINT_EVENTS);
    const exitPoint =
      options["exit-point"] === "none"
        ? null
        : oneOf(options["exit-point"], PILOT_EXIT_POINTS);
    if (event === undefined || exitPoint === undefined) {
      throw new Error("pilot_input_invalid");
    }
    const session = await checkpointPilotSession({
      privateRoot: options["private-root"] ?? "",
      sessionId: options["session-id"] ?? "",
      event,
      exitPoint,
      ...(options.at === undefined ? {} : { at: options.at }),
    });
    output(io, {
      ok: true,
      command: "session_checkpoint",
      sessionId: session.sessionId,
      event,
    });
    return 0;
  }
  if (action === "finish" && parsed.positionals.length === 2) {
    const required = [
      "private-root",
      "session-id",
      "exit-result",
      "repeat-correction-impact",
      "finding-necessary",
      "finding-unnecessary",
      "finding-uncertain",
      "brief-burden",
      "decision-burden",
      "issue-burden",
      "manifest-burden",
      "recovery-burden",
      "download-outcome",
      "download-minutes",
      "checksum-outcome",
      "checksum-minutes",
      "extraction-outcome",
      "extraction-minutes",
      "first-launch-outcome",
      "first-launch-minutes",
      "time-to-room-minutes",
      "failure-point",
      "project-outcome",
      "brief-outcome",
      "review-outcome",
      "manifest-outcome",
      "disposition-outcome",
      "receipt-outcome",
      "recovery-outcome",
      "relaunch-outcome",
      "local-web-outcome",
      "local-web-friction",
      "local-web-blocking",
      "preferred-entry",
      "desktop-need",
      "desktop-solution-evidence",
      "ui-need",
      "synthetic-case-discussion",
      "would-use-again",
      "failure-observed",
      "negative-feedback-observed",
    ];
    if (!exactOptions(options, required, ["at"])) {
      throw new Error("pilot_input_invalid");
    }
    const exitResult = oneOf(options["exit-result"], SESSION_EXIT_RESULTS);
    const repeatCorrectionImpact = oneOf(
      options["repeat-correction-impact"],
      REPEAT_CORRECTION_IMPACTS,
    );
    const findingAssessment: FindingAssessmentCounts = {
      necessary: integer(options["finding-necessary"], 0, 1_000) ?? -1,
      unnecessary: integer(options["finding-unnecessary"], 0, 1_000) ?? -1,
      uncertain: integer(options["finding-uncertain"], 0, 1_000) ?? -1,
    };
    const maintenanceBurden: MaintenanceBurdenScores = {
      brief: (integer(options["brief-burden"], 1, 5) ?? 0) as BurdenScore,
      decision: (integer(options["decision-burden"], 1, 5) ?? 0) as BurdenScore,
      issue: (integer(options["issue-burden"], 1, 5) ?? 0) as BurdenScore,
      manifest: (integer(options["manifest-burden"], 1, 5) ?? 0) as BurdenScore,
      recovery: (integer(options["recovery-burden"], 1, 5) ?? 0) as BurdenScore,
    };
    const distribution: PilotDistributionObservation = {
      download: {
        outcome: oneOf(options["download-outcome"], STEP_OUTCOMES) ??
          "not_observed",
        durationMinutes: nullableInteger(options["download-minutes"], 0, 240) ??
          null,
      },
      checksumVerification: {
        outcome: oneOf(options["checksum-outcome"], STEP_OUTCOMES) ??
          "not_observed",
        durationMinutes: nullableInteger(options["checksum-minutes"], 0, 240) ??
          null,
      },
      extraction: {
        outcome: oneOf(options["extraction-outcome"], STEP_OUTCOMES) ??
          "not_observed",
        durationMinutes: nullableInteger(options["extraction-minutes"], 0, 240) ??
          null,
      },
      firstLaunch: {
        outcome: oneOf(options["first-launch-outcome"], STEP_OUTCOMES) ??
          "not_observed",
        durationMinutes: nullableInteger(options["first-launch-minutes"], 0, 240) ??
          null,
      },
      timeToRoomMinutes: nullableInteger(
        options["time-to-room-minutes"],
        0,
        480,
      ) ?? null,
      failurePoint:
        options["failure-point"] === "none"
          ? null
          : oneOf(options["failure-point"], PILOT_EXIT_POINTS) ?? null,
    };
    const journey: PilotJourneyObservation = {
      project: oneOf(options["project-outcome"], JOURNEY_OUTCOMES) ??
        "not_observed",
      brief: oneOf(options["brief-outcome"], JOURNEY_OUTCOMES) ??
        "not_observed",
      review: oneOf(options["review-outcome"], JOURNEY_OUTCOMES) ??
        "not_observed",
      manifest: oneOf(options["manifest-outcome"], JOURNEY_OUTCOMES) ??
        "not_observed",
      disposition: oneOf(
        options["disposition-outcome"],
        JOURNEY_OUTCOMES,
      ) ?? "not_observed",
      receipt: oneOf(options["receipt-outcome"], JOURNEY_OUTCOMES) ??
        "not_observed",
      recovery: oneOf(options["recovery-outcome"], RECOVERY_OUTCOMES) ??
        "not_observed",
      relaunch: oneOf(options["relaunch-outcome"], STEP_OUTCOMES) ??
        "not_observed",
    };
    const localWebLifecycle: LocalWebLifecycleObservation = {
      outcome: oneOf(options["local-web-outcome"], STEP_OUTCOMES) ??
        "not_observed",
      frictionSeverity: oneOf(
        options["local-web-friction"],
        FRICTION_SEVERITIES,
      ) ?? "none",
      blocking: boolean(options["local-web-blocking"]) ?? false,
    };
    const preferredEntry = oneOf(
      options["preferred-entry"],
      PREFERRED_ENTRIES,
    );
    const desktopNeed = oneOf(options["desktop-need"], DESKTOP_NEEDS);
    const desktopSolutionEvidence = oneOf(
      options["desktop-solution-evidence"],
      DESKTOP_SOLUTION_EVIDENCE,
    );
    const uiNeed = oneOf(options["ui-need"], UI_NEEDS);
    const syntheticCaseDiscussion = oneOf(
      options["synthetic-case-discussion"],
      SYNTHETIC_CASE_DISCUSSION_VALUES,
    );
    const wouldUseAgain = oneOf(
      options["would-use-again"],
      WOULD_USE_AGAIN_VALUES,
    );
    const failureObserved = boolean(options["failure-observed"]);
    const negativeFeedbackObserved = boolean(
      options["negative-feedback-observed"],
    );
    if (
      exitResult === undefined ||
      repeatCorrectionImpact === undefined ||
      Object.values(findingAssessment).some((value) => value < 0) ||
      Object.values(maintenanceBurden).some((value) => value < 1) ||
      oneOf(options["download-outcome"], STEP_OUTCOMES) === undefined ||
      oneOf(options["checksum-outcome"], STEP_OUTCOMES) === undefined ||
      oneOf(options["extraction-outcome"], STEP_OUTCOMES) === undefined ||
      oneOf(options["first-launch-outcome"], STEP_OUTCOMES) === undefined ||
      nullableInteger(options["download-minutes"], 0, 240) === undefined ||
      nullableInteger(options["checksum-minutes"], 0, 240) === undefined ||
      nullableInteger(options["extraction-minutes"], 0, 240) === undefined ||
      nullableInteger(options["first-launch-minutes"], 0, 240) === undefined ||
      nullableInteger(options["time-to-room-minutes"], 0, 480) === undefined ||
      (options["failure-point"] !== "none" &&
        oneOf(options["failure-point"], PILOT_EXIT_POINTS) === undefined) ||
      oneOf(options["project-outcome"], JOURNEY_OUTCOMES) === undefined ||
      oneOf(options["brief-outcome"], JOURNEY_OUTCOMES) === undefined ||
      oneOf(options["review-outcome"], JOURNEY_OUTCOMES) === undefined ||
      oneOf(options["manifest-outcome"], JOURNEY_OUTCOMES) === undefined ||
      oneOf(options["disposition-outcome"], JOURNEY_OUTCOMES) === undefined ||
      oneOf(options["receipt-outcome"], JOURNEY_OUTCOMES) === undefined ||
      oneOf(options["recovery-outcome"], RECOVERY_OUTCOMES) === undefined ||
      oneOf(options["relaunch-outcome"], STEP_OUTCOMES) === undefined ||
      oneOf(options["local-web-outcome"], STEP_OUTCOMES) === undefined ||
      oneOf(options["local-web-friction"], FRICTION_SEVERITIES) === undefined ||
      boolean(options["local-web-blocking"]) === undefined ||
      preferredEntry === undefined ||
      desktopNeed === undefined ||
      desktopSolutionEvidence === undefined ||
      uiNeed === undefined ||
      syntheticCaseDiscussion === undefined ||
      wouldUseAgain === undefined ||
      failureObserved === undefined ||
      negativeFeedbackObserved === undefined
    ) {
      throw new Error("pilot_input_invalid");
    }
    const session = await finishPilotSession({
      privateRoot: options["private-root"] ?? "",
      sessionId: options["session-id"] ?? "",
      ...(options.at === undefined ? {} : { at: options.at }),
      exitResult,
      repeatCorrectionImpact,
      findingAssessment,
      maintenanceBurden,
      distribution,
      journey,
      localWebLifecycle,
      preferredEntry,
      desktopNeed,
      desktopSolutionEvidence,
      uiNeed,
      syntheticCaseDiscussion,
      wouldUseAgain,
      failureObserved,
      negativeFeedbackObserved,
    });
    output(io, {
      ok: true,
      command: "session_finish",
      sessionId: session.sessionId,
      exitResult: session.finish?.exitResult,
    });
    return 0;
  }
  if (
    (action === "show" || action === "delete") &&
    parsed.positionals.length === 2
  ) {
    const required = ["private-root", "session-id"];
    if (
      !exactOptions(options, required, action === "delete" ? ["yes"] : []) ||
      (action === "delete" && boolean(options.yes) !== true)
    ) {
      throw new Error("pilot_input_invalid");
    }
    if (action === "show") {
      const session = await showPilotSession({
        privateRoot: options["private-root"] ?? "",
        sessionId: options["session-id"] ?? "",
      });
      output(io, { ok: true, command: "session_show", session });
    } else {
      await deletePilotSession({
        privateRoot: options["private-root"] ?? "",
        sessionId: options["session-id"] ?? "",
      });
      output(io, {
        ok: true,
        command: "session_delete",
        sessionId: options["session-id"],
      });
    }
    return 0;
  }
  throw new Error("pilot_input_invalid");
}

export async function runPilotCli(
  args: readonly string[],
  io: PilotCliIo = DEFAULT_IO,
): Promise<0 | 1 | 2> {
  try {
    const parsed = parseArguments(args);
    if (parsed === undefined) throw new Error("pilot_input_invalid");
    const command = parsed.positionals[0];
    if (command === "session") return await runSessionCommand(parsed, io);
    if (command === "export" && parsed.positionals.length === 1) {
      if (
        !exactOptions(parsed.options, [
          "private-root",
          "session-id",
          "output",
        ])
      ) {
        throw new Error("pilot_input_invalid");
      }
      const exported = await exportPilotSession({
        privateRoot: parsed.options["private-root"] ?? "",
        sessionId: parsed.options["session-id"] ?? "",
        exportPath: parsed.options.output ?? "",
      });
      output(io, {
        ok: true,
        command: "export",
        sessionId: exported.sessionId,
        evidenceId: exported.evidenceId,
        contentHash: exported.contentHash,
      });
      return 0;
    }
    if (command === "aggregate" && parsed.positionals.length === 1) {
      if (
        !exactOptions(parsed.options, [
          "input-dir",
          "json-output",
          "markdown-output",
        ])
      ) {
        throw new Error("pilot_input_invalid");
      }
      const report = await aggregatePilotExportDirectory({
        inputDirectory: parsed.options["input-dir"] ?? "",
        jsonOutput: parsed.options["json-output"] ?? "",
        markdownOutput: parsed.options["markdown-output"] ?? "",
      });
      output(io, {
        ok: true,
        command: "aggregate",
        sampleStatus: report.sample.status,
        secondUseStatus: report.secondUse.status,
        externalParticipantCount: report.sample.externalParticipantCount,
        externalSessionCount: report.sample.externalSessionCount,
      });
      return 0;
    }
    if (command === "verify-kit" && parsed.positionals.length === 1) {
      if (!exactOptions(parsed.options, ["kit-root"])) {
        throw new Error("pilot_input_invalid");
      }
      const verified = await verifyPilotKit(parsed.options["kit-root"] ?? "");
      output(io, {
        ok: true,
        command: "verify_kit",
        pilotKitVersion: verified.manifest.pilotKitVersion,
        releaseVersion: verified.manifest.sestinaRelease.version,
        releaseBuildId: verified.manifest.sestinaRelease.buildId,
        verifiedFileCount: verified.verifiedFiles.length,
      });
      return 0;
    }
    throw new Error("pilot_input_invalid");
  } catch (error) {
    return errorOutput(io, error);
  }
}
