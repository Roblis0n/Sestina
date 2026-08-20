import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { ConnectionPaths } from "./path-safety.js";
import { revalidateConnectionTargets } from "./path-safety.js";

export type ConnectionFileAction =
  | { readonly action: "write"; readonly relativePath: string; readonly path: string; readonly content: string }
  | { readonly action: "delete"; readonly relativePath: string; readonly path: string };

export interface TransactionHooks {
  readonly beforeCommit?: (relativePath: string, index: number) => void | Promise<void>;
}

export type TransactionResult =
  | { readonly ok: true; readonly backupCreated: boolean }
  | { readonly ok: false; readonly error: { readonly code: "infrastructure_failure"; readonly rollbackFailed: boolean } };

interface OriginalFile {
  readonly exists: boolean;
  readonly content?: Buffer;
}

interface PreparedWrite {
  readonly action: Extract<ConnectionFileAction, { readonly action: "write" }>;
  readonly temporaryPath: string;
}

async function missingParentDirectories(projectRoot: string, actions: readonly ConnectionFileAction[]): Promise<readonly string[]> {
  const missing = new Set<string>();
  for (const action of actions) {
    let cursor = dirname(action.path);
    while (cursor !== projectRoot && relative(projectRoot, cursor).split(sep)[0] !== "..") {
      try { await stat(cursor); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        missing.add(cursor);
      }
      cursor = dirname(cursor);
    }
  }
  return [...missing].toSorted((left, right) => right.length - left.length);
}

async function removeCreatedEmptyDirectories(directories: readonly string[]): Promise<void> {
  for (const directory of directories) {
    try { await rmdir(directory); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOTEMPTY" && code !== "ENOENT") throw error;
    }
  }
}

async function originalFile(path: string): Promise<OriginalFile> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not_regular_file");
    return { exists: true, content: await readFile(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${basename(path)}.sestina-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { flag: "wx", flush: true });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function backupDirectoryName(actions: readonly ConnectionFileAction[], originals: ReadonlyMap<string, OriginalFile>, now: Date): string {
  const hash = createHash("sha256");
  for (const action of actions) {
    const original = originals.get(action.path);
    if (original?.exists !== true || original.content === undefined) continue;
    hash.update(action.relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(original.content);
  }
  const timestamp = now.toISOString().replace(/[-:.]/gu, "");
  return `${timestamp}-${hash.digest("hex").slice(0, 16)}`;
}

async function createBackups(
  paths: ConnectionPaths,
  actions: readonly ConnectionFileAction[],
  originals: ReadonlyMap<string, OriginalFile>,
  now: Date,
): Promise<boolean> {
  const existing = actions.filter((action) => originals.get(action.path)?.exists === true);
  if (existing.length === 0) return false;
  const backupDirectory = join(paths.backupRoot, backupDirectoryName(actions, originals, now));
  for (const action of existing) {
    const original = originals.get(action.path);
    if (original?.content === undefined) throw new Error("backup_source_unavailable");
    const backupPath = join(backupDirectory, ...action.relativePath.split("/"));
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, original.content, { flag: "wx", flush: true });
  }
  return true;
}

async function rollback(
  committed: readonly ConnectionFileAction[],
  originals: ReadonlyMap<string, OriginalFile>,
): Promise<boolean> {
  try {
    for (const action of [...committed].reverse()) {
      const original = originals.get(action.path);
      if (original?.exists === true && original.content !== undefined) await atomicWrite(action.path, original.content);
      else await rm(action.path, { force: true });
    }
    return true;
  } catch {
    return false;
  }
}

export async function executeConnectionTransaction(
  paths: ConnectionPaths,
  actions: readonly ConnectionFileAction[],
  cleanupDirectories: readonly string[],
  hooks: TransactionHooks = {},
  now = new Date(),
): Promise<TransactionResult> {
  if (actions.length === 0) return { ok: true, backupCreated: false };
  const originals = new Map<string, OriginalFile>();
  const prepared: PreparedWrite[] = [];
  const committed: ConnectionFileAction[] = [];
  let initiallyMissingDirectories: readonly string[] = [];
  let backupCreated: boolean;
  try {
    if (!(await revalidateConnectionTargets(paths))) throw new Error("unsafe_target");
    initiallyMissingDirectories = await missingParentDirectories(paths.projectRoot, actions);
    for (const action of actions) originals.set(action.path, await originalFile(action.path));
    backupCreated = await createBackups(paths, actions, originals, now);

    for (const action of actions) {
      if (action.action !== "write") continue;
      await mkdir(dirname(action.path), { recursive: true });
      const temporaryPath = join(dirname(action.path), `.${basename(action.path)}.sestina-${randomUUID()}.tmp`);
      await writeFile(temporaryPath, action.content, { flag: "wx", flush: true });
      prepared.push({ action, temporaryPath });
    }
    if (!(await revalidateConnectionTargets(paths))) throw new Error("unsafe_target");

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      if (action === undefined) throw new Error("transaction_action_missing");
      await hooks.beforeCommit?.(action.relativePath, index);
      if (!(await revalidateConnectionTargets(paths))) throw new Error("unsafe_target");
      if (action.action === "write") {
        const pending = prepared.find((value) => value.action === action);
        if (pending === undefined) throw new Error("prepared_write_missing");
        await rename(pending.temporaryPath, action.path);
      } else {
        await rm(action.path, { force: true });
      }
      committed.push(action);
    }

    for (const directory of cleanupDirectories) {
      try { await rmdir(directory); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return { ok: true, backupCreated };
  } catch {
    await Promise.all(prepared.map((value) => rm(value.temporaryPath, { force: true }).catch(() => undefined)));
    const restored = await rollback(committed, originals);
    const directoriesRestored = await removeCreatedEmptyDirectories(initiallyMissingDirectories).then(() => true).catch(() => false);
    return { ok: false, error: { code: "infrastructure_failure", rollbackFailed: !restored || !directoriesRestored } };
  } finally {
    await Promise.all(prepared.map((value) => rm(value.temporaryPath, { force: true }).catch(() => undefined)));
  }
}
