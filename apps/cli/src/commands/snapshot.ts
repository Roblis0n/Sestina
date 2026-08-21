import { getReleaseIdentity, type CoreResult } from "@sestina/core";
import { stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";

function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode { return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Snapshot command could not be completed."); }
interface SnapshotProjectionInput { readonly id: string; readonly episodeId: string; readonly buildVersion: string; readonly limitations: readonly string[]; readonly createdAt: string; readonly hashMeaning: string; readonly hash: string; }
function view(value: SnapshotProjectionInput): Readonly<Record<string, unknown>> { return { snapshotId: value.id, episodeId: value.episodeId, buildVersion: value.buildVersion, limitations: value.limitations, createdAt: value.createdAt, hashMeaning: value.hashMeaning, hash: value.hash }; }

export async function runSnapshot(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const subcommand = args.positionals[1]; const id = args.positionals[2] ?? "";
  const opened = await openLocalProject(stringOption(args, "project"), io);
  if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if (subcommand === "create" && args.positionals.length === 3) {
      const buildVersion = stringOption(args, "build-version") ?? getReleaseIdentity().releaseBuildId;
      const limitations = [stringOption(args, "limitation") ?? "Deterministic integrity checks and a content hash do not prove research correctness."];
      const created = local.core.createResearchSnapshot({ projectId: local.project.id, episodeId: id, buildVersion, limitations }); if (!created.ok) return coreFailure(created, io, json);
      success(io, json, { command: "snapshot create", ...view(created.value), immutable: true, provesResearchCorrectness: false }, `Created immutable Snapshot ${created.value.id}; its hash proves content integrity only.`); return EXIT_CODES.success;
    }
    if (subcommand === "show" && args.positionals.length === 3) {
      const shown = local.core.getSnapshot(local.project.id, id); if (!shown.ok) return coreFailure(shown, io, json);
      if (!shown.value) return failure(io, json, EXIT_CODES.stateConflict, "not_found", "The Snapshot was not found.");
      success(io, json, { command: "snapshot show", ...view(shown.value), provesResearchCorrectness: false }, JSON.stringify(view(shown.value), null, 2)); return EXIT_CODES.success;
    }
    if (subcommand === "verify" && args.positionals.length === 3) {
      const verified = local.core.verifyResearchSnapshot(local.project.id, id); if (!verified.ok) return coreFailure(verified, io, json);
      success(io, json, { command: "snapshot verify", snapshotId: id, integrityHashValid: verified.value, hashMeaning: "content_integrity_only", provesResearchCorrectness: false }, verified.value ? "Snapshot content-integrity hash is valid; research correctness is not proven." : "Snapshot content-integrity hash is invalid."); return verified.value ? EXIT_CODES.success : EXIT_CODES.stateConflict;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use snapshot create, show, or verify.");
  } finally { local.core.close(); }
}
