#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseCliArguments, stringOption } from "./arguments.js";
import { runArtifact } from "./commands/artifact.js";
import { runBrief } from "./commands/brief.js";
import { runDoctor, type DoctorOptions } from "./commands/doctor.js";
import { runEpisode } from "./commands/episode.js";
import { runInit, type InitOptions } from "./commands/init.js";
import { runRevision } from "./commands/revision.js";
import { EXIT_CODES, type CliExitCode } from "./exit-codes.js";
import { failure, type CliIo } from "./output.js";

export type { CliIo } from "./output.js";

export const CLI_HELP = `Sestina local research revision workflow

  sestina init --project <dir> --title <title> --yes
  sestina doctor [--project <dir>]
  sestina brief show|edit|propose-change|accept-change
  sestina artifact add|list
  sestina revision add|diff
  sestina episode start|submit|show

Use --json for stable machine output. Authority-changing Brief actions require --yes.
`;

export async function runCli(args: readonly string[], io: CliIo): Promise<CliExitCode> {
  const parsed = parseCliArguments(args);
  const json = parsed.options.json === true;
  if (!parsed.valid) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Command arguments are invalid.");
  const command = parsed.positionals[0];
  if (parsed.options.help === true || command === "help") {
    io.stdout(CLI_HELP);
    return EXIT_CODES.success;
  }
  if (command === "init" && parsed.positionals.length === 1) {
    const options: InitOptions = { project: stringOption(parsed, "project"), title: stringOption(parsed, "title"), yes: parsed.options.yes === true, json };
    return runInit(options, io);
  }
  if (command === "doctor" && parsed.positionals.length === 1) {
    if (parsed.options.title !== undefined || parsed.options.yes !== undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Command arguments are invalid.");
    const options: DoctorOptions = { project: stringOption(parsed, "project"), json };
    return runDoctor(options, io);
  }
  if (command === "brief") return runBrief(parsed, io);
  if (command === "artifact") return runArtifact(parsed, io);
  if (command === "revision") return runRevision(parsed, io);
  if (command === "episode") return runEpisode(parsed, io);
  return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use a Sestina research command such as init, doctor, brief, artifact, revision, or episode.");
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const io: CliIo = {
    cwd: process.cwd(),
    isTTY: process.stdin.isTTY,
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  process.exitCode = await runCli(process.argv.slice(2), io);
}
