import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { getReleaseIdentity, openSestina, type CoreErrorCode } from "@sestina/core";
import { EXIT_CODES, exitCodeForCoreError, type CliExitCode } from "../exit-codes.js";
import { failure, success, type CliIo } from "../output.js";
import { findProjectRoot } from "../project-root.js";
import type { CliDependencies } from "../connections/connection-plan.js";
import { resolveConnectionPaths } from "../connections/path-safety.js";
import { defaultCodexRuntimeLocator } from "../connections/runtime-locator.js";
import { detectConnectionStatus } from "../connections/status.js";

export interface DoctorOptions { readonly project?: string; readonly json: boolean; }

async function existsFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

function coreFailure(io: CliIo, json: boolean, code: CoreErrorCode): CliExitCode {
  const exit = exitCodeForCoreError(code);
  return failure(io, json, exit, code, exit === EXIT_CODES.projectNotInitialized ? "The project is not initialized." : "Local diagnostics could not complete.");
}

export async function runDoctor(options: DoctorOptions, io: CliIo, dependencies: CliDependencies = {}): Promise<CliExitCode> {
  const root = options.project === undefined ? await findProjectRoot(io.cwd) : resolve(io.cwd, options.project);
  if (root === undefined) return failure(io, options.json, EXIT_CODES.projectNotInitialized, "project_not_initialized", "The project is not initialized.");
  const stateDirectory = join(root, ".sestina");
  const databasePath = join(stateDirectory, "state.sqlite");
  const briefPath = join(stateDirectory, "research-brief.yaml");
  if (!(await existsFile(databasePath)) || !(await existsFile(briefPath))) return failure(io, options.json, EXIT_CODES.projectNotInitialized, "project_not_initialized", "The project is not initialized.");
  try {
    await access(root, constants.R_OK | constants.W_OK);
    await access(stateDirectory, constants.R_OK | constants.W_OK);
  } catch {
    return failure(io, options.json, EXIT_CODES.infrastructureFailure, "infrastructure_failure", "The project path is not readable and writable.");
  }
  const opened = await openSestina({ databasePath });
  if (!opened.ok) return coreFailure(io, options.json, opened.error.code);
  const core = opened.value;
  try {
    const projects = core.listProjects();
    if (!projects.ok) return coreFailure(io, options.json, projects.error.code);
    if (projects.value.length !== 1) return failure(io, options.json, EXIT_CODES.stateConflict, "state_conflict", "The local project binding is inconsistent.");
    const project = projects.value[0];
    if (project === undefined) return failure(io, options.json, EXIT_CODES.stateConflict, "state_conflict", "The local project binding is inconsistent.");
    const diagnostics = await core.diagnoseDatabase({ backupDirectory: join(stateDirectory, "backups"), dataRoot: stateDirectory });
    if (!diagnostics.ok) return coreFailure(io, options.json, diagnostics.error.code);
    const projection = core.getActiveBriefProjection(project.id);
    if (!projection.ok) return coreFailure(io, options.json, projection.error.code);
    const briefText = await readFile(briefPath, "utf8");
    const briefStatus = projection.value === undefined
      ? "draft_not_activated" as const
      : briefText.replaceAll("\r\n", "\n").trim() === projection.value.yaml.replaceAll("\r\n", "\n").trim()
        ? "in_sync" as const
        : "drift" as const;
    const connectionPaths = await resolveConnectionPaths(root, io.cwd);
    const connection = connectionPaths.ok
      ? (await detectConnectionStatus(connectionPaths.value, dependencies.runtimeLocator ?? defaultCodexRuntimeLocator)).status
      : {
          host: "codex" as const,
          scope: "project" as const,
          state: "conflict" as const,
          mcp: { status: "conflict" as const },
          skill: { status: "conflict" as const },
          runtime: { status: "unavailable" as const },
          activation: { projectTrustRequired: true as const, restartRequired: false },
          hostVerification: "unverified" as const,
        };
    const release = getReleaseIdentity();
    const value = {
      command: "doctor",
      version: {
        cli: release.version,
        runtime: diagnostics.value.schema.runtimeVersion,
        node: process.versions.node,
        nodeRange: release.nodeRange,
        releaseBuildId: release.releaseBuildId,
        databaseSchemaVersion: release.databaseSchemaVersion,
        migrationCount: release.migrationCount,
        reportSchemaVersion: release.reportSchemaVersion,
        capsuleResponseSchemaVersion: release.capsuleResponseSchemaVersion,
        mcpServerVersion: release.mcpServerVersion,
        mcpResearchContextSchemaVersion: release.mcpResearchContextSchemaVersion,
      },
      platform: { os: process.platform, architecture: process.arch },
      projectRoot: ".",
      paths: { project: "read_write", state: "read_write" },
      database: diagnostics.value.database,
      schema: diagnostics.value.schema,
      brief: { status: briefStatus },
      backup: diagnostics.value.backup,
      connection: { state: connection.state, hostVerification: connection.hostVerification },
      mcp: connection.mcp,
      skill: connection.skill,
      runtime: connection.runtime,
    };
    if (briefStatus === "drift" || diagnostics.value.schema.status !== "current") {
      return failure(io, options.json, EXIT_CODES.stateConflict, "stale_state", "Local state differs from its authoritative projection.");
    }
    success(io, options.json, value, `Sestina doctor: local project state is healthy; Codex configuration is ${connection.state}; host verification is unverified.`);
    return EXIT_CODES.success;
  } catch {
    return failure(io, options.json, EXIT_CODES.infrastructureFailure, "infrastructure_failure", "Local diagnostics could not complete.");
  } finally {
    core.close();
  }
}
