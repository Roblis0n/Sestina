import { createProjectStateBackup, inspectProjectRecovery, previewProjectStateRestore, restoreProjectState, type CoreErrorCode } from "@sestina/core";
import { resolve } from "node:path";
import { stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, exitCodeForCoreError, type CliExitCode } from "../exit-codes.js";
import { failure, success, type CliIo } from "../output.js";
import { findProjectRoot } from "../project-root.js";

async function projectRoot(parsed: ParsedCliArguments, io: CliIo): Promise<string | undefined> {
  const explicit = stringOption(parsed, "project");
  return explicit === undefined ? findProjectRoot(io.cwd) : resolve(io.cwd, explicit);
}

function dataFailure(io: CliIo, json: boolean, code: CoreErrorCode, restoreSource = false): CliExitCode {
  const exit = restoreSource && code === "not_found" ? EXIT_CODES.stateConflict : exitCodeForCoreError(code);
  const message = code === "invalid_input" ? "The backup identifier or command arguments are invalid."
    : code === "not_found" ? (restoreSource ? "The requested managed backup does not exist." : "The project is not initialized.")
      : code === "user_confirmation_required" ? "Explicit --yes confirmation is required."
        : code === "state_conflict" || code === "stale_state" ? "The recovery material failed validation or no longer matches the validated source."
          : "The local recovery operation could not complete safely.";
  return failure(io, json, exit, code, message);
}

function only(parsed: ParsedCliArguments, allowed: readonly string[]): boolean {
  return Object.keys(parsed.options).every((name) => allowed.includes(name));
}

export async function runData(parsed: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = parsed.options.json === true; const action = parsed.positionals[1];
  if (action === "status" && parsed.positionals.length === 2 && only(parsed, ["project", "json"])) {
    const root = await projectRoot(parsed, io); if (root === undefined) return dataFailure(io, json, "not_found");
    const result = await inspectProjectRecovery({ projectRoot: root }); if (!result.ok) return dataFailure(io, json, result.error.code);
    success(io, json, { command: "data status", ...result.value }, `Sestina data: current state ${result.value.currentState}; ${result.value.backups.length} verified local recovery choice(s).`);
    return EXIT_CODES.success;
  }
  if (action === "backup" && parsed.positionals.length === 2 && only(parsed, ["project", "json"])) {
    const root = await projectRoot(parsed, io); if (root === undefined) return dataFailure(io, json, "not_found");
    const result = await createProjectStateBackup({ projectRoot: root }); if (!result.ok) return dataFailure(io, json, result.error.code);
    success(io, json, { command: "data backup", ...result.value }, `Sestina data: complete local backup ${result.value.backupId} verified.`);
    return EXIT_CODES.success;
  }
  if (action === "restore" && parsed.positionals.length === 3 && only(parsed, ["project", "yes", "json"])) {
    const root = await projectRoot(parsed, io); if (root === undefined) return dataFailure(io, json, "not_found");
    const backupId = parsed.positionals[2];
    if (backupId === undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "A managed backup identifier is required.");
    if (parsed.options.yes !== true) {
      const preview = await previewProjectStateRestore({ projectRoot: root, backupId });
      if (!preview.ok) return dataFailure(io, json, preview.error.code, true);
      const message = `Restore ${backupId} only after verifying this local recovery choice; pass --yes to replace the current database and Research Brief together.`;
      if (json) io.stderr(`${JSON.stringify({ ok: false, command: "data restore", ...preview.value, error: { code: "user_confirmation_required", message }, exitCode: EXIT_CODES.userConfirmationRequired })}\n`);
      else io.stderr(`Error: ${message}\n`);
      return EXIT_CODES.userConfirmationRequired;
    }
    const restored = await restoreProjectState({ projectRoot: root, backupId, confirmed: true });
    if (!restored.ok) return dataFailure(io, json, restored.error.code, true);
    success(io, json, { command: "data restore", ...restored.value }, `Sestina data: restored ${backupId}; database and Research Brief binding verified.`);
    return EXIT_CODES.success;
  }
  return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use sestina data status|backup or data restore <backup-id> [--yes].");
}
