import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { connectProject, type CliDependencies, type ConnectionOperationResult } from "../connections/connection-plan.js";
import { failure, success, type CliIo } from "../output.js";

export interface ConnectOptions {
  readonly project?: string;
  readonly host?: string;
  readonly yes: boolean;
  readonly json: boolean;
}

function operationFailure(result: Extract<ConnectionOperationResult, { readonly ok: false }>, io: CliIo, json: boolean): CliExitCode {
  switch (result.error.code) {
    case "project_not_initialized": return failure(io, json, EXIT_CODES.projectNotInitialized, result.error.code, "The project is not initialized.");
    case "state_conflict": return failure(io, json, EXIT_CODES.stateConflict, result.error.code, "The Codex connection has conflicting or foreign state.");
    case "runtime_unavailable": return failure(io, json, EXIT_CODES.infrastructureFailure, result.error.code, "The local Sestina MCP runtime is unavailable.");
    case "infrastructure_failure": return failure(io, json, EXIT_CODES.infrastructureFailure, result.error.code, result.error.rollbackFailed === true
      ? "The connection update failed and rollback could not complete."
      : "The connection update failed and was rolled back.");
  }
}

function confirmationRequired(io: CliIo, json: boolean, plan: readonly { readonly action: string; readonly path: string }[]): CliExitCode {
  if (json) {
    io.stderr(`${JSON.stringify({
      ok: false,
      command: "connect",
      host: "codex",
      scope: "project",
      plan,
      error: { code: "user_confirmation_required", message: "Pass --yes to apply the project-scoped Codex connection plan." },
      exitCode: EXIT_CODES.userConfirmationRequired,
    })}\n`);
  } else {
    io.stdout(`Codex connection plan:\n${plan.map((item) => `  ${item.action} ${item.path}`).join("\n")}\n`);
    io.stderr("Error: Pass --yes to apply this project-scoped connection plan.\n");
  }
  return EXIT_CODES.userConfirmationRequired;
}

export async function runConnect(options: ConnectOptions, io: CliIo, dependencies: CliDependencies = {}): Promise<CliExitCode> {
  if ((options.host ?? "codex") !== "codex") {
    return failure(io, options.json, EXIT_CODES.unsupportedFormat, "unsupported_format", "Only the project-scoped Codex host is supported.");
  }
  const result = await connectProject(options.project, io, options.yes, dependencies);
  if (!result.ok) return operationFailure(result, io, options.json);
  if (!options.yes && !result.value.idempotent) return confirmationRequired(io, options.json, result.value.plan);
  const value = {
    command: "connect",
    ...result.value.status,
    configuration: result.value.status.state,
    idempotent: result.value.idempotent,
    backupCreated: result.value.backupCreated,
  };
  success(io, options.json, value, result.value.idempotent
    ? "Sestina Codex project configuration is already current; no files were changed."
    : "Configured the project-scoped Sestina Skill and read-only MCP. Trust the project and reopen Codex to activate them; host verification remains unverified.");
  return EXIT_CODES.success;
}
