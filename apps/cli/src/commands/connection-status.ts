import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { getPrivacyManifest } from "@sestina/core";
import { getConnectionStatus, verifyProjectHost, type CliDependencies, type ConnectionOperationResult } from "../connections/connection-plan.js";
import type { CodexVerificationErrorCode } from "../connections/codex-host-verifier.js";
import { failure, success, type CliIo } from "../output.js";

export interface ConnectionStatusOptions {
  readonly project?: string;
  readonly host?: string;
  readonly verifyHost: boolean;
  readonly yes: boolean;
  readonly codexExecutable?: string;
  readonly json: boolean;
}

function statusFailure(result: Extract<ConnectionOperationResult, { readonly ok: false }>, io: CliIo, json: boolean): CliExitCode {
  if (result.error.code === "project_not_initialized") return failure(io, json, EXIT_CODES.projectNotInitialized, result.error.code, "The project is not initialized.");
  if (result.error.code === "state_conflict") return failure(io, json, EXIT_CODES.stateConflict, result.error.code, "The Codex connection paths are unsafe or conflicting.");
  return failure(io, json, EXIT_CODES.infrastructureFailure, result.error.code, "The Codex connection status is unavailable.");
}

function isConnectionFailureCode(value: string): value is Extract<ConnectionOperationResult, { readonly ok: false }>["error"]["code"] {
  return value === "project_not_initialized" || value === "state_conflict" || value === "runtime_unavailable" || value === "infrastructure_failure";
}

function confirmationRequired(io: CliIo, json: boolean): CliExitCode {
  const flow = getPrivacyManifest().dataFlows.codexHost;
  const disclosure = `may send ${flow.fields.join(", ")} to the ${flow.recipient.replaceAll("_", " ")}`;
  const message = `Host verification starts one Codex model call and ${disclosure}. Pass --yes to continue.`;
  if (json) {
    io.stderr(`${JSON.stringify({
      ok: false,
      command: "connection-status",
      host: "codex",
      scope: "project",
      hostVerification: "unverified",
      disclosure,
      error: { code: "user_confirmation_required", message },
      exitCode: EXIT_CODES.userConfirmationRequired,
    })}\n`);
  } else io.stderr(`Error: ${message}\n`);
  return EXIT_CODES.userConfirmationRequired;
}

function verificationFailure(
  io: CliIo,
  json: boolean,
  error: { readonly code: CodexVerificationErrorCode; readonly exitCode?: number | null; readonly stdoutBytes?: number; readonly stderrBytes?: number },
): CliExitCode {
  const message = "Codex host verification did not produce the required bounded MCP evidence.";
  if (json) {
    io.stderr(`${JSON.stringify({
      ok: false,
      command: "connection-status",
      host: "codex",
      scope: "project",
      hostVerification: "unverified",
      error: { code: error.code, message },
      diagnostics: {
        ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
        ...(error.stdoutBytes === undefined ? {} : { stdoutBytes: error.stdoutBytes }),
        ...(error.stderrBytes === undefined ? {} : { stderrBytes: error.stderrBytes }),
      },
      exitCode: EXIT_CODES.infrastructureFailure,
    })}\n`);
    return EXIT_CODES.infrastructureFailure;
  }
  return failure(io, false, EXIT_CODES.infrastructureFailure, error.code, message);
}

export async function runConnectionStatus(
  options: ConnectionStatusOptions,
  io: CliIo,
  dependencies: CliDependencies = {},
): Promise<CliExitCode> {
  if ((options.host ?? "codex") !== "codex") {
    return failure(io, options.json, EXIT_CODES.unsupportedFormat, "unsupported_format", "Only the project-scoped Codex host is supported.");
  }
  if (options.codexExecutable !== undefined && (!options.verifyHost || !options.yes)) {
    return failure(io, options.json, EXIT_CODES.invalidInput, "invalid_input", "--codex-executable requires --verify-host --yes.");
  }
  if (options.verifyHost) {
    const staticResult = await getConnectionStatus(options.project, io, dependencies);
    if (!staticResult.ok) return statusFailure(staticResult, io, options.json);
    if (staticResult.value.status.state !== "configured") {
      return failure(io, options.json, EXIT_CODES.stateConflict, "state_conflict", "Static Codex configuration must be configured before host verification.");
    }
    if (!options.yes) return confirmationRequired(io, options.json);
    const verified = await verifyProjectHost(options.project, io, dependencies, options.codexExecutable);
    if (!verified.ok) {
      if (isConnectionFailureCode(verified.error.code)) {
        const code = verified.error.code;
        return statusFailure({ ok: false, error: { code } }, io, options.json);
      }
      return verificationFailure(io, options.json, verified.error as { readonly code: CodexVerificationErrorCode });
    }
    success(io, options.json, {
      command: "connection-status",
      ...verified.value.status,
      hostVerification: "verified",
      verification: verified.value.verification,
    }, "Sestina Codex project configuration is configured and this invocation observed both required read-only MCP calls.");
    return EXIT_CODES.success;
  }
  const result = await getConnectionStatus(options.project, io, dependencies);
  if (!result.ok) return statusFailure(result, io, options.json);
  const value = { command: "connection-status", ...result.value.status };
  success(io, options.json, value, `Sestina Codex project configuration: ${result.value.status.state}; host verification: unverified.`);
  return EXIT_CODES.success;
}
