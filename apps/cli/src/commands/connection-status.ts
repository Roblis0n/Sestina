import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { getConnectionStatus, type CliDependencies, type ConnectionOperationResult } from "../connections/connection-plan.js";
import { failure, success, type CliIo } from "../output.js";

export interface ConnectionStatusOptions {
  readonly project?: string;
  readonly host?: string;
  readonly json: boolean;
}

function statusFailure(result: Extract<ConnectionOperationResult, { readonly ok: false }>, io: CliIo, json: boolean): CliExitCode {
  if (result.error.code === "project_not_initialized") return failure(io, json, EXIT_CODES.projectNotInitialized, result.error.code, "The project is not initialized.");
  if (result.error.code === "state_conflict") return failure(io, json, EXIT_CODES.stateConflict, result.error.code, "The Codex connection paths are unsafe or conflicting.");
  return failure(io, json, EXIT_CODES.infrastructureFailure, result.error.code, "The Codex connection status is unavailable.");
}

export async function runConnectionStatus(
  options: ConnectionStatusOptions,
  io: CliIo,
  dependencies: CliDependencies = {},
): Promise<CliExitCode> {
  if ((options.host ?? "codex") !== "codex") {
    return failure(io, options.json, EXIT_CODES.unsupportedFormat, "unsupported_format", "Only the project-scoped Codex host is supported.");
  }
  const result = await getConnectionStatus(options.project, io, dependencies);
  if (!result.ok) return statusFailure(result, io, options.json);
  const value = { command: "connection-status", ...result.value.status };
  success(io, options.json, value, `Sestina Codex project configuration: ${result.value.status.state}; host verification: unverified.`);
  return EXIT_CODES.success;
}
