#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseCliArguments, stringOption, type ParsedCliArguments } from "./arguments.js";
import { runArtifact } from "./commands/artifact.js";
import { runBrief } from "./commands/brief.js";
import { runCapsule } from "./commands/capsule.js";
import { runConnect, type ConnectOptions } from "./commands/connect.js";
import { runConnectionStatus, type ConnectionStatusOptions } from "./commands/connection-status.js";
import { runDecision } from "./commands/decision.js";
import { runDisconnect, type DisconnectOptions } from "./commands/disconnect.js";
import { runDoctor, type DoctorOptions } from "./commands/doctor.js";
import { runEpisode } from "./commands/episode.js";
import { runIssue } from "./commands/issue.js";
import { runInit, type InitOptions } from "./commands/init.js";
import { runRevision } from "./commands/revision.js";
import { runReviewCommand } from "./commands/review.js";
import { runReport } from "./commands/report.js";
import { runSnapshot } from "./commands/snapshot.js";
import { EXIT_CODES, type CliExitCode } from "./exit-codes.js";
import { failure, type CliIo } from "./output.js";
import type { CliDependencies } from "./connections/connection-plan.js";

export type { CliIo } from "./output.js";

export const CLI_HELP = `Sestina local research revision workflow

  sestina init --project <dir> --title <title> --yes
  sestina doctor [--project <dir>]
  sestina connect [--project <dir>] [--host codex] [--yes] [--json]
  sestina connection-status [--project <dir>] [--host codex] [--verify-host --yes] [--json]
  sestina disconnect [--project <dir>] [--host codex] [--yes] [--json]
  sestina brief show|edit|propose-change|accept-change
  sestina artifact add|list
  sestina revision add|diff
  sestina episode start|submit|show
  sestina decision add|list|accept|reject|freeze|supersede
  sestina issue list|show|resolve|waive|dispute|reopen
sestina review run|show [--all-findings]
  sestina episode accept|reject|waive
  sestina snapshot create|show|verify
sestina report markdown|json [--all-findings]
  sestina capsule export|import-response

Use --json for stable machine output. Authority-changing research actions require --yes.
`;

function onlyOptions(parsed: ParsedCliArguments, allowed: ReadonlySet<string>): boolean {
  return Object.keys(parsed.options).every((name) => allowed.has(name));
}

export async function runCli(args: readonly string[], io: CliIo, dependencies: CliDependencies = {}): Promise<CliExitCode> {
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
    return runDoctor(options, io, dependencies);
  }
  if (command === "connect" && parsed.positionals.length === 1) {
    if (!onlyOptions(parsed, new Set(["project", "host", "yes", "json"]))) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Command arguments are invalid.");
    const options: ConnectOptions = { project: stringOption(parsed, "project"), host: stringOption(parsed, "host"), yes: parsed.options.yes === true, json };
    return runConnect(options, io, dependencies);
  }
  if (command === "connection-status" && parsed.positionals.length === 1) {
    if (!onlyOptions(parsed, new Set(["project", "host", "verify-host", "yes", "json"]))) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Command arguments are invalid.");
    const options: ConnectionStatusOptions = { project: stringOption(parsed, "project"), host: stringOption(parsed, "host"), verifyHost: parsed.options["verify-host"] === true, yes: parsed.options.yes === true, json };
    return runConnectionStatus(options, io, dependencies);
  }
  if (command === "disconnect" && parsed.positionals.length === 1) {
    if (!onlyOptions(parsed, new Set(["project", "host", "yes", "json"]))) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Command arguments are invalid.");
    const options: DisconnectOptions = { project: stringOption(parsed, "project"), host: stringOption(parsed, "host"), yes: parsed.options.yes === true, json };
    return runDisconnect(options, io, dependencies);
  }
  if (command === "brief") return runBrief(parsed, io);
  if (command === "artifact") return runArtifact(parsed, io);
  if (command === "revision") return runRevision(parsed, io);
  if (command === "episode") return runEpisode(parsed, io);
  if (command === "decision") return runDecision(parsed, io);
  if (command === "issue") return runIssue(parsed, io);
  if (command === "review") return runReviewCommand(parsed, io);
  if (command === "snapshot") return runSnapshot(parsed, io);
  if (command === "report") return runReport(parsed, io);
  if (command === "capsule") return runCapsule(parsed, io);
  return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use a Sestina local research command; run sestina help for the command list.");
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
