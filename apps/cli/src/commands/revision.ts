import type { CoreResult } from "@sestina/core";
import { stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";
import { mediaTypeForPath, readProjectTextFile } from "../project-file.js";

function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode {
  return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Revision command could not be completed.");
}

export async function runRevision(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const subcommand = args.positionals[1];
  const opened = await openLocalProject(stringOption(args, "project"), io);
  if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if (subcommand === "add" && args.positionals.length === 3) {
      const artifactId = args.positionals[2] ?? ""; const path = stringOption(args, "path");
      if (path === undefined || path.replaceAll("\\", "/").startsWith(".sestina/")) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "revision add requires an Artifact ID and project-relative --path.");
      const artifact = local.core.getArtifact(local.project.id, artifactId);
      if (!artifact.ok) return coreFailure(artifact, io, json);
      const activeRevisionId = artifact.value?.activeRevisionId;
      if (activeRevisionId === undefined) return failure(io, json, EXIT_CODES.stateConflict, "state_conflict", "The Artifact has no active baseline Revision.");
      const file = await readProjectTextFile(local.root, path);
      if (file === undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "The Revision content file does not exist inside the project.");
      const revision = local.core.createRevision({ projectId: local.project.id, artifactId, parentRevisionId: activeRevisionId, content: file.content, mediaType: mediaTypeForPath(file.relativePath), actor: { kind: "user", actorId: "cli-user" } });
      if (!revision.ok) return coreFailure(revision, io, json);
      success(io, json, { command: "revision add", artifactId, revisionId: revision.value.id, parentRevisionId: revision.value.parentRevisionId, contentHash: revision.value.content.contentHash, byteLength: revision.value.content.byteLength, sourcePath: file.relativePath }, `Created Revision ${revision.value.id}.`);
      return EXIT_CODES.success;
    }
    if (subcommand === "diff" && args.positionals.length === 4) {
      const baselineRevisionId = args.positionals[2] ?? ""; const candidateRevisionId = args.positionals[3] ?? "";
      const diff = local.core.diffRevisions(local.project.id, baselineRevisionId, candidateRevisionId); if (!diff.ok) return coreFailure(diff, io, json);
      const changes = diff.value.changes.map((change) => ({ operation: change.operation, blockId: change.blockId, heading: change.heading, baselineLines: change.baseline ? [change.baseline.startLine, change.baseline.endLine] : undefined, candidateLines: change.candidate ? [change.candidate.startLine, change.candidate.endLine] : undefined }));
      success(io, json, { command: "revision diff", baselineRevisionId, candidateRevisionId, scopeUnknown: diff.value.scopeUnknown, changes }, changes.length === 0 ? "No block changes." : changes.map((item) => `${item.operation} ${item.heading ?? item.blockId}`).join("\n"));
      return EXIT_CODES.success;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use revision add or revision diff.");
  } finally {
    local.core.close();
  }
}
