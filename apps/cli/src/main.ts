#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runDoctor, type DoctorOptions } from "./commands/doctor.js";
import { runInit, type InitOptions } from "./commands/init.js";
import { EXIT_CODES, type CliExitCode } from "./exit-codes.js";
import { failure, type CliIo } from "./output.js";

export type { CliIo } from "./output.js";

function parse(args: readonly string[]): { readonly command?: string; readonly values: Readonly<Record<string, string | boolean>>; readonly valid: boolean } {
  const [command, ...rest] = args;
  const values: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--yes" || token === "--json") { values[token.slice(2)] = true; continue; }
    if (token === "--project" || token === "--title") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) return { command, values, valid: false };
      values[token.slice(2)] = value;
      index += 1;
      continue;
    }
    return { command, values, valid: false };
  }
  return { command, values, valid: true };
}

export async function runCli(args: readonly string[], io: CliIo): Promise<CliExitCode> {
  const parsed = parse(args);
  const json = parsed.values.json === true;
  if (!parsed.valid) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Command arguments are invalid.");
  if (parsed.command === "init") {
    const options: InitOptions = { project: typeof parsed.values.project === "string" ? parsed.values.project : undefined, title: typeof parsed.values.title === "string" ? parsed.values.title : undefined, yes: parsed.values.yes === true, json };
    return runInit(options, io);
  }
  if (parsed.command === "doctor") {
    if (parsed.values.title !== undefined || parsed.values.yes !== undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Command arguments are invalid.");
    const options: DoctorOptions = { project: typeof parsed.values.project === "string" ? parsed.values.project : undefined, json };
    return runDoctor(options, io);
  }
  return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use `sestina init` or `sestina doctor`.");
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
