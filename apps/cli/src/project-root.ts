import { access, mkdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

export async function ensureProjectRoot(rawPath: string, cwd: string): Promise<string | undefined> {
  const target = resolve(cwd, rawPath);
  try {
    await mkdir(target, { recursive: true });
    if (!(await isDirectory(target))) return undefined;
    await access(target, constants.R_OK | constants.W_OK);
    return await realpath(target);
  } catch {
    return undefined;
  }
}

export async function findProjectRoot(start: string): Promise<string | undefined> {
  let cursor = resolve(start);
  const root = parse(cursor).root;
  while (cursor !== root) {
    if (await isDirectory(join(cursor, ".sestina"))) return cursor;
    cursor = dirname(cursor);
  }
  return await isDirectory(join(root, ".sestina")) ? root : undefined;
}
