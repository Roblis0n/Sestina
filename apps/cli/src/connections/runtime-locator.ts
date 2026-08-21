import { readFile, stat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface CodexRuntimeLocation {
  readonly packageRoot: string;
  readonly serverEntry: string;
  readonly nodeExecutable: string;
}

export type CodexRuntimeLocationResult =
  | { readonly ok: true; readonly value: CodexRuntimeLocation }
  | { readonly ok: false; readonly error: { readonly code: "runtime_unavailable" } };

export type CodexRuntimeLocator = () => Promise<CodexRuntimeLocationResult>;

function within(root: string, target: string): boolean {
  const value = relative(root, target);
  return value.length === 0 || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function canonicalFile(path: string): Promise<string | undefined> {
  if (!isAbsolute(path)) return undefined;
  try {
    const canonical = await realpath(path);
    return (await stat(canonical)).isFile() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

async function validCliManifest(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return value.name === "@sestina/cli" && typeof value.version === "string";
  } catch {
    return false;
  }
}

export async function locateCodexRuntimeFromCliModule(moduleUrl: string, nodePath: string): Promise<CodexRuntimeLocationResult> {
  try {
    if (process.versions.node.split(".")[0] !== "24") return { ok: false, error: { code: "runtime_unavailable" } };
    const modulePath = fileURLToPath(moduleUrl);
    const packageRoot = await realpath(resolve(dirname(modulePath), ".."));
    const packageJson = await canonicalFile(join(packageRoot, "package.json"));
    const serverEntry = await canonicalFile(join(packageRoot, "dist", "mcp", "main.js"));
    const nodeExecutable = await canonicalFile(nodePath);
    if (packageJson === undefined || serverEntry === undefined || nodeExecutable === undefined
      || !within(packageRoot, packageJson) || !within(packageRoot, serverEntry) || !(await validCliManifest(packageJson))) {
      return { ok: false, error: { code: "runtime_unavailable" } };
    }
    return { ok: true, value: { packageRoot, serverEntry, nodeExecutable } };
  } catch {
    return { ok: false, error: { code: "runtime_unavailable" } };
  }
}

export const defaultCodexRuntimeLocator: CodexRuntimeLocator = () => {
  return locateCodexRuntimeFromCliModule(import.meta.url, process.execPath);
};

export async function validateCodexRuntime(locator: CodexRuntimeLocator): Promise<CodexRuntimeLocationResult> {
  const located = await locator();
  if (!located.ok) return located;
  const packageRoot = isAbsolute(located.value.packageRoot) ? await realpath(located.value.packageRoot).catch(() => undefined) : undefined;
  const packageJson = packageRoot === undefined ? undefined : await canonicalFile(join(packageRoot, "package.json"));
  const serverEntry = await canonicalFile(located.value.serverEntry);
  const nodeExecutable = await canonicalFile(located.value.nodeExecutable);
  if (packageRoot === undefined || packageJson === undefined || serverEntry === undefined || nodeExecutable === undefined) {
    return { ok: false, error: { code: "runtime_unavailable" } };
  }
  try {
    if (!(await stat(packageRoot)).isDirectory() || !within(packageRoot, packageJson) || !within(packageRoot, serverEntry) || !(await validCliManifest(packageJson))) {
      return { ok: false, error: { code: "runtime_unavailable" } };
    }
  } catch {
    return { ok: false, error: { code: "runtime_unavailable" } };
  }
  return { ok: true, value: { packageRoot, serverEntry, nodeExecutable } };
}
