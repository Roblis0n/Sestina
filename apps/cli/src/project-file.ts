import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ProjectTextFile { readonly relativePath: string; readonly content: string; }

export async function readProjectTextFile(root: string, inputPath: string): Promise<ProjectTextFile | undefined> {
  if (inputPath.trim().length === 0 || isAbsolute(inputPath)) return undefined;
  const target = resolve(root, inputPath);
  let canonicalRoot: string; let canonicalTarget: string;
  try { canonicalRoot = await realpath(root); canonicalTarget = await realpath(target); } catch { return undefined; }
  const within = relative(canonicalRoot, canonicalTarget);
  if (within.length === 0 || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) return undefined;
  try {
    if (!(await stat(canonicalTarget)).isFile()) return undefined;
    return { relativePath: within.split(sep).join("/"), content: await readFile(canonicalTarget, "utf8") };
  } catch {
    return undefined;
  }
}

export async function writeBriefProjection(path: string, content: string): Promise<boolean> {
  try { await writeFile(path, content, "utf8"); return true; } catch { return false; }
}

export function mediaTypeForPath(path: string): "text/markdown" | "text/plain" | "application/json" {
  const lower = path.toLowerCase();
  return lower.endsWith(".json") ? "application/json" : lower.endsWith(".md") || lower.endsWith(".markdown") ? "text/markdown" : "text/plain";
}
