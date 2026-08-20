import { readFile, stat } from "node:fs/promises";
import type { CliIo } from "../output.js";
import { renderManagedCodexConfig, removeManagedCodexConfig } from "./codex-config.js";
import { codexSkillFiles, inspectCodexSkill } from "./codex-skill.js";
import {
  executeConnectionTransaction,
  type ConnectionFileAction,
  type TransactionHooks,
} from "./filesystem-transaction.js";
import {
  parentDirectoriesForSkillCleanup,
  resolveConnectionPaths,
  type ConnectionPaths,
} from "./path-safety.js";
import {
  defaultCodexRuntimeLocator,
  validateCodexRuntime,
  type CodexRuntimeLocator,
} from "./runtime-locator.js";
import { detectConnectionStatus, type ConnectionStatus } from "./status.js";

export interface CliDependencies {
  readonly runtimeLocator?: CodexRuntimeLocator;
  readonly transactionHooks?: TransactionHooks;
}

export interface ConnectionPlanItem {
  readonly action: "write" | "delete";
  readonly path: string;
}

export type ConnectionOperationResult =
  | {
    readonly ok: true;
    readonly value: {
      readonly status: ConnectionStatus;
      readonly plan: readonly ConnectionPlanItem[];
      readonly idempotent: boolean;
      readonly backupCreated: boolean;
    };
  }
  | {
    readonly ok: false;
    readonly error: {
      readonly code: "project_not_initialized" | "state_conflict" | "runtime_unavailable" | "infrastructure_failure";
      readonly rollbackFailed?: boolean;
    };
  };

export type ConnectionPreviewResult =
  | { readonly ok: true; readonly value: ConnectionOperationResult & { readonly ok: true } }
  | { readonly ok: false; readonly error: ConnectionOperationResult & { readonly ok: false } };

async function readOptional(path: string): Promise<{ readonly exists: boolean; readonly content: string } | undefined> {
  try {
    if (!(await stat(path)).isFile()) return undefined;
    return { exists: true, content: await readFile(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, content: "" };
    return undefined;
  }
}

function operationPlan(actions: readonly ConnectionFileAction[]): readonly ConnectionPlanItem[] {
  return actions.map((action) => ({ action: action.action, path: action.relativePath }));
}

function pathError(code: "project_not_initialized" | "state_conflict" | "infrastructure_failure"): ConnectionOperationResult {
  return { ok: false, error: { code } };
}

async function resolvePaths(project: string | undefined, io: CliIo): Promise<ConnectionPaths | ConnectionOperationResult> {
  const resolved = await resolveConnectionPaths(project, io.cwd);
  return resolved.ok ? resolved.value : pathError(resolved.error.code);
}

async function currentStatus(paths: ConnectionPaths, dependencies: CliDependencies): Promise<ConnectionStatus> {
  return (await detectConnectionStatus(paths, dependencies.runtimeLocator ?? defaultCodexRuntimeLocator)).status;
}

export async function getConnectionStatus(
  project: string | undefined,
  io: CliIo,
  dependencies: CliDependencies = {},
): Promise<ConnectionOperationResult> {
  const paths = await resolvePaths(project, io);
  if ("ok" in paths) return paths;
  const status = await currentStatus(paths, dependencies);
  return { ok: true, value: { status, plan: [], idempotent: true, backupCreated: false } };
}

export async function connectProject(
  project: string | undefined,
  io: CliIo,
  confirmed: boolean,
  dependencies: CliDependencies = {},
): Promise<ConnectionOperationResult> {
  const paths = await resolvePaths(project, io);
  if ("ok" in paths) return paths;
  const runtime = await validateCodexRuntime(dependencies.runtimeLocator ?? defaultCodexRuntimeLocator);
  if (!runtime.ok) return { ok: false, error: { code: "runtime_unavailable" } };
  const config = await readOptional(paths.configPath);
  if (config === undefined) return { ok: false, error: { code: "state_conflict" } };
  const rendered = renderManagedCodexConfig(config.content, {
    nodeExecutable: runtime.value.nodeExecutable,
    serverEntry: runtime.value.serverEntry,
    projectRoot: paths.projectRoot,
  });
  if (!rendered.ok) return { ok: false, error: { code: "state_conflict" } };
  const skill = await inspectCodexSkill(paths.projectRoot);
  if (skill.status === "conflict" || (skill.status === "drifted" && skill.ownership !== "known_previous")) {
    return { ok: false, error: { code: "state_conflict" } };
  }

  const actions: ConnectionFileAction[] = [];
  if (rendered.value.changed) actions.push({ action: "write", relativePath: ".codex/config.toml", path: paths.configPath, content: rendered.value.content });
  if (skill.status === "not_configured" || skill.ownership === "known_previous") {
    for (const file of codexSkillFiles(paths.projectRoot)) {
      actions.push({ action: "write", relativePath: file.relativePath, path: file.path, content: file.content });
    }
  }
  const plan = operationPlan(actions);
  if (!confirmed) {
    const status = await currentStatus(paths, dependencies);
    return { ok: true, value: { status, plan, idempotent: actions.length === 0, backupCreated: false } };
  }
  const transaction = await executeConnectionTransaction(paths, actions, [], dependencies.transactionHooks);
  if (!transaction.ok) return { ok: false, error: transaction.error };
  const status = await currentStatus(paths, dependencies);
  if (status.state !== "configured") return { ok: false, error: { code: "infrastructure_failure" } };
  return { ok: true, value: { status, plan, idempotent: actions.length === 0, backupCreated: transaction.backupCreated } };
}

export async function disconnectProject(
  project: string | undefined,
  io: CliIo,
  confirmed: boolean,
  dependencies: CliDependencies = {},
): Promise<ConnectionOperationResult> {
  const paths = await resolvePaths(project, io);
  if ("ok" in paths) return paths;
  const config = await readOptional(paths.configPath);
  if (config === undefined) return { ok: false, error: { code: "state_conflict" } };
  const removed = removeManagedCodexConfig(config.content);
  if (!removed.ok) return { ok: false, error: { code: "state_conflict" } };
  const skill = await inspectCodexSkill(paths.projectRoot);
  if (skill.status === "conflict" || (skill.status === "drifted" && skill.ownership !== "known_previous")) {
    return { ok: false, error: { code: "state_conflict" } };
  }

  const actions: ConnectionFileAction[] = [];
  if (removed.value.changed) {
    actions.push(removed.value.deleteFile
      ? { action: "delete", relativePath: ".codex/config.toml", path: paths.configPath }
      : { action: "write", relativePath: ".codex/config.toml", path: paths.configPath, content: removed.value.content });
  }
  const removeOwnedSkill = skill.status === "configured" || skill.ownership === "known_previous";
  if (removeOwnedSkill) {
    for (const file of codexSkillFiles(paths.projectRoot).toReversed()) {
      actions.push({ action: "delete", relativePath: file.relativePath, path: file.path });
    }
  }
  const plan = operationPlan(actions);
  if (!confirmed) {
    const status = await currentStatus(paths, dependencies);
    return { ok: true, value: { status, plan, idempotent: actions.length === 0, backupCreated: false } };
  }
  const cleanup = removeOwnedSkill ? parentDirectoriesForSkillCleanup(paths) : [];
  const transaction = await executeConnectionTransaction(paths, actions, cleanup, dependencies.transactionHooks);
  if (!transaction.ok) return { ok: false, error: transaction.error };
  const status = await currentStatus(paths, dependencies);
  if (status.state !== "not_connected") return { ok: false, error: { code: "infrastructure_failure" } };
  return { ok: true, value: { status, plan, idempotent: actions.length === 0, backupCreated: transaction.backupCreated } };
}
