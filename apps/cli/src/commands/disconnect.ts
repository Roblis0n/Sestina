import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { disconnectProject, type CliDependencies, type ConnectionOperationResult } from "../connections/connection-plan.js";
import { failure, success, type CliIo } from "../output.js";

export interface DisconnectOptions {
  readonly project?: string;
  readonly host?: string;
  readonly yes: boolean;
  readonly json: boolean;
}

function operationFailure(result: Extract<ConnectionOperationResult, { readonly ok: false }>, io: CliIo, json: boolean): CliExitCode {
  switch (result.error.code) {
    case "project_not_initialized": return failure(io, json, EXIT_CODES.projectNotInitialized, result.error.code, "The project is not initialized.");
    case "state_conflict": return failure(io, json, EXIT_CODES.stateConflict, result.error.code, "The Sestina-owned Codex connection cannot be removed because its ownership state conflicts.");
    case "runtime_unavailable": return failure(io, json, EXIT_CODES.infrastructureFailure, result.error.code, "The local Sestina MCP runtime is unavailable.");
    case "infrastructure_failure": return failure(io, json, EXIT_CODES.infrastructureFailure, result.error.code, result.error.rollbackFailed === true
      ? "The disconnect failed and rollback could not complete."
      : "The disconnect failed and was rolled back.");
  }
}

function confirmationRequired(io: CliIo, json: boolean, plan: readonly { readonly action: string; readonly path: string }[]): CliExitCode {
  if (json) {
    io.stderr(`${JSON.stringify({
      ok: false,
      command: "disconnect",
      host: "codex",
      scope: "project",
      plan,
      error: { code: "user_confirmation_required", message: "Pass --yes to remove only the Sestina-owned Codex connection files." },
      exitCode: EXIT_CODES.userConfirmationRequired,
    })}\n`);
  } else {
    io.stdout(`Codex disconnect plan:\n${plan.map((item) => `  ${item.action} ${item.path}`).join("\n")}\n`);
    io.stderr("Error: Pass --yes to apply this project-scoped disconnect plan.\n");
  }
  return EXIT_CODES.userConfirmationRequired;
}

export async function runDisconnect(options: DisconnectOptions, io: CliIo, dependencies: CliDependencies = {}): Promise<CliExitCode> {
  if ((options.host ?? "codex") !== "codex") {
    return failure(io, options.json, EXIT_CODES.unsupportedFormat, "unsupported_format", "Only the project-scoped Codex host is supported.");
  }
  const result = await disconnectProject(options.project, io, options.yes, dependencies);
  if (!result.ok) return operationFailure(result, io, options.json);
  if (!options.yes && !result.value.idempotent) return confirmationRequired(io, options.json, result.value.plan);
  const value = {
    command: "disconnect",
    ...result.value.status,
    configuration: result.value.status.state,
    idempotent: result.value.idempotent,
    backupCreated: result.value.backupCreated,
  };
  success(io, options.json, value, result.value.idempotent
    ? "The project has no Sestina-owned Codex connection files; no files were changed."
    : "Removed only the Sestina-owned Codex Skill and managed MCP block. Core research data was preserved; reopen Codex to apply the change.");
  return EXIT_CODES.success;
}
