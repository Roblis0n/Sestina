import { readFile, stat } from "node:fs/promises";
import type { ConnectionPaths } from "./path-safety.js";
import { inspectCodexConfig, type CodexConfigStatus } from "./codex-config.js";
import { inspectCodexSkill, type CodexSkillStatus } from "./codex-skill.js";
import {
  defaultCodexRuntimeLocator,
  validateCodexRuntime,
  type CodexRuntimeLocator,
  type CodexRuntimeLocationResult,
} from "./runtime-locator.js";

export type ConnectionState = "not_connected" | "configured" | "drifted" | "conflict" | "runtime_unavailable";

export interface ConnectionStatus {
  readonly host: "codex";
  readonly scope: "project";
  readonly state: ConnectionState;
  readonly mcp: { readonly status: CodexConfigStatus };
  readonly skill: { readonly status: CodexSkillStatus };
  readonly runtime: { readonly status: "available" | "unavailable" };
  readonly activation: { readonly projectTrustRequired: true; readonly restartRequired: boolean };
  readonly hostVerification: "unverified";
}

const CONFIG_SOURCE_CONFLICT = Symbol("config_source_conflict");

async function configSource(path: string): Promise<string | undefined | typeof CONFIG_SOURCE_CONFLICT> {
  try {
    if (!(await stat(path)).isFile()) return CONFIG_SOURCE_CONFLICT;
    return await readFile(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : CONFIG_SOURCE_CONFLICT;
  }
}

export async function detectConnectionStatus(
  paths: ConnectionPaths,
  runtimeLocator: CodexRuntimeLocator = defaultCodexRuntimeLocator,
): Promise<{ readonly status: ConnectionStatus; readonly runtime: CodexRuntimeLocationResult }> {
  const runtime = await validateCodexRuntime(runtimeLocator);
  const source = await configSource(paths.configPath);
  const mcp = source === CONFIG_SOURCE_CONFLICT
    ? { status: "conflict" as const }
    : source === undefined
      ? { status: "not_configured" as const }
      : inspectCodexConfig(source, runtime.ok
        ? { nodeExecutable: runtime.value.nodeExecutable, serverEntry: runtime.value.serverEntry, projectRoot: paths.projectRoot }
        : undefined);
  const skill = await inspectCodexSkill(paths.projectRoot);
  let state: ConnectionState;
  if (mcp.status === "conflict" || skill.status === "conflict") state = "conflict";
  else if (mcp.status === "not_configured" && skill.status === "not_configured") state = "not_connected";
  else if (!runtime.ok) state = "runtime_unavailable";
  else if (mcp.status === "configured" && skill.status === "configured") state = "configured";
  else state = "drifted";
  return {
    runtime,
    status: {
      host: "codex",
      scope: "project",
      state,
      mcp,
      skill,
      runtime: { status: runtime.ok ? "available" : "unavailable" },
      activation: {
        projectTrustRequired: true,
        restartRequired: state !== "not_connected",
      },
      hostVerification: "unverified",
    },
  };
}
