import { randomBytes } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  aggregatePilotExports,
  renderPilotAggregateJson,
  renderPilotAggregateMarkdown,
  type PilotAggregateReport,
} from "./aggregate.js";

function invalid(code: string): never {
  throw new Error(code);
}

function safeDirectory(path: string, code: string): string {
  if (!isAbsolute(path) || path.includes("\0")) invalid(code);
  const resolved = resolve(path);
  let stat;
  try {
    stat = lstatSync(resolved);
  } catch {
    invalid(code);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalid(code);
  const canonical = realpathSync.native(resolved);
  if (
    (process.platform === "win32" ? canonical.toLowerCase() : canonical) !==
    (process.platform === "win32" ? resolved.toLowerCase() : resolved)
  ) {
    invalid(code);
  }
  return canonical;
}

function normalized(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function assertNoLinkedAncestor(path: string): void {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  const parts = relative(root, resolved).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        invalid("pilot_output_invalid");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
}

async function safeOutput(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) invalid("pilot_output_invalid");
  const resolved = resolve(path);
  const segments = resolved.split(/[\\/]+/u).map((part) => part.toLowerCase());
  if (segments.includes(".sestina") || segments.includes("pilot-private")) {
    invalid("pilot_output_invalid");
  }
  const parent = dirname(resolved);
  assertNoLinkedAncestor(parent);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalid("pilot_output_invalid");
  if (normalized(realpathSync.native(parent)) !== normalized(parent)) {
    invalid("pilot_output_invalid");
  }
  try {
    const target = lstatSync(resolved);
    if (!target.isFile() || target.isSymbolicLink()) invalid("pilot_output_invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolved;
}

async function atomicText(path: string, content: string): Promise<void> {
  const temp = join(
    dirname(path),
    `.pilot-output-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } catch {
    await rm(temp, { force: true });
    invalid("pilot_output_write_failed");
  }
}

export async function readPilotExportDirectory(
  inputDirectory: string,
): Promise<readonly unknown[]> {
  const root = safeDirectory(inputDirectory, "pilot_aggregate_input_invalid");
  const entries = (await readdir(root, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  if (entries.length > 1_000) invalid("pilot_aggregate_input_invalid");
  const values: unknown[] = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !/^[A-Za-z0-9._-]+\.json$/u.test(entry.name)
    ) {
      invalid("pilot_aggregate_input_invalid");
    }
    const path = join(root, entry.name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_048_576) {
      invalid("pilot_aggregate_input_invalid");
    }
    try {
      values.push(JSON.parse(await readFile(path, "utf8")) as unknown);
    } catch {
      invalid("pilot_aggregate_input_invalid");
    }
  }
  return values;
}

export async function aggregatePilotExportDirectory(input: {
  readonly inputDirectory: string;
  readonly jsonOutput: string;
  readonly markdownOutput: string;
}): Promise<PilotAggregateReport> {
  const exports = await readPilotExportDirectory(input.inputDirectory);
  const report = aggregatePilotExports(exports);
  const jsonOutput = await safeOutput(input.jsonOutput);
  const markdownOutput = await safeOutput(input.markdownOutput);
  if (jsonOutput === markdownOutput) invalid("pilot_output_invalid");
  await atomicText(jsonOutput, renderPilotAggregateJson(report));
  await atomicText(markdownOutput, renderPilotAggregateMarkdown(report));
  return report;
}
