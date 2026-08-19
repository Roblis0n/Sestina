import type { CoreResult } from "@sestina/core";
import { stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";
import { readProjectTextFile } from "../project-file.js";

function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode { return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Capsule command could not be completed."); }
export async function runCapsule(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const subcommand = args.positionals[1]; const input = args.positionals[2] ?? "";
  const opened = await openLocalProject(stringOption(args, "project"), io); if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if (subcommand === "export" && args.positionals.length === 3) {
      const exported = local.core.exportCapsule({ projectId: local.project.id, episodeId: input, includePermittedFullText: args.options["include-full-text"] === true }); if (!exported.ok) return coreFailure(exported, io, json);
      if (json) success(io, true, { command: "capsule export", episodeId: input, capsule: exported.value.json, authority: "read_only_projection", canMutateAuthority: false }, ""); else io.stdout(`${exported.value.json}\n`);
      return EXIT_CODES.success;
    }
    if (subcommand === "import-response" && args.positionals.length === 3) {
      const file = await readProjectTextFile(local.root, input); if (!file) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Capsule response must be a project-relative readable file.");
      const imported = local.core.importCapsuleResponse(local.project.id, file.content); if (!imported.ok) return coreFailure(imported, io, json);
      success(io, json, { command: "capsule import-response", ...imported.value, sourcePath: file.relativePath }, "Imported a model proposal as a non-authoritative candidate; no research state was changed."); return EXIT_CODES.success;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use capsule export <episode> or capsule import-response <file>.");
  } finally { local.core.close(); }
}
