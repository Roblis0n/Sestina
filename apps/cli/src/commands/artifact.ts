import type { CoreResult, CreateArtifactWithRevisionCommand } from "@sestina/core";
import { stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";
import { mediaTypeForPath, readProjectTextFile } from "../project-file.js";

type ArtifactKind = CreateArtifactWithRevisionCommand["kind"];
const KINDS = new Set<ArtifactKind>(["manuscript", "section", "interview", "codebook", "dataset", "analysis", "review_response", "research_note"]);

function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode {
  return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Artifact command could not be completed.");
}

export async function runArtifact(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const subcommand = args.positionals[1];
  const opened = await openLocalProject(stringOption(args, "project"), io);
  if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if (subcommand === "add" && args.positionals.length === 2) {
      const kind = stringOption(args, "kind"); const path = stringOption(args, "path");
      if (kind === undefined || !KINDS.has(kind as ArtifactKind) || path === undefined || path.replaceAll("\\", "/").startsWith(".sestina/")) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "artifact add requires a valid --kind and project-relative --path.");
      const file = await readProjectTextFile(local.root, path);
      if (file === undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "The Artifact content file does not exist inside the project.");
      const created = local.core.createArtifactWithInitialRevision({ projectId: local.project.id, kind: kind as ArtifactKind, relativePath: file.relativePath, content: file.content, mediaType: mediaTypeForPath(file.relativePath), actor: { kind: "user", actorId: "cli-user" } });
      if (!created.ok) return coreFailure(created, io, json);
      success(io, json, { command: "artifact add", artifactId: created.value.artifact.id, kind: created.value.artifact.kind, path: created.value.artifact.title, revisionId: created.value.revision.id, contentHash: created.value.revision.content.contentHash, byteLength: created.value.revision.content.byteLength }, `Registered ${created.value.artifact.title} at revision ${created.value.revision.id}.`);
      return EXIT_CODES.success;
    }
    if (subcommand === "list" && args.positionals.length === 2) {
      const artifacts = local.core.listArtifacts(local.project.id); if (!artifacts.ok) return coreFailure(artifacts, io, json);
      const values = artifacts.value.map((artifact) => ({ id: artifact.id, kind: artifact.kind, path: artifact.title, activeRevisionId: artifact.activeRevisionId, revisionCount: artifact.revisions.length }));
      success(io, json, { command: "artifact list", artifacts: values }, values.length === 0 ? "No research Artifacts." : values.map((item) => `${item.id}  ${item.kind}  ${item.path}`).join("\n"));
      return EXIT_CODES.success;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use artifact add or artifact list.");
  } finally {
    local.core.close();
  }
}
