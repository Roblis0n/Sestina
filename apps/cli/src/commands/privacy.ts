import { getPrivacyManifest } from "@sestina/core";
import type { ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { failure, success, type CliIo } from "../output.js";

export function runPrivacy(parsed: ParsedCliArguments, io: CliIo): CliExitCode {
  const json = parsed.options.json === true;
  if (parsed.positionals.length !== 2 || parsed.positionals[1] !== "show" || Object.keys(parsed.options).some((name) => name !== "project" && name !== "json")) {
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use sestina privacy show [--project <dir>] [--json].");
  }
  const manifest = getPrivacyManifest();
  success(io, json, { command: "privacy show", scope: "project", ...manifest }, "Sestina privacy: local project state; network denied by default; no automatic telemetry, crash reporting, content logging, or upload; external models cannot mutate research authority.");
  return EXIT_CODES.success;
}
