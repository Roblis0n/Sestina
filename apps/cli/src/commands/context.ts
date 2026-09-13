import { resolve } from "node:path";
import {
  openLegacyResearchReader,
  readKernelReadonlyContext,
} from "@sestina/core";
import { findProjectRoot } from "../project-root.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { failure, success, type CliIo } from "../output.js";

/** Local reading and diagnostics share the same Kernel-owned projection as the
 * read-only integration. They never create a backup or repair project state. */
export async function runReadonlyContext(
  project: string | undefined,
  diagnostics: boolean,
  json: boolean,
  io: CliIo,
): Promise<CliExitCode> {
  const root =
    project === undefined
      ? await findProjectRoot(io.cwd)
      : resolve(io.cwd, project);
  if (!root)
    return failure(
      io,
      json,
      EXIT_CODES.projectNotInitialized,
      "project_not_initialized",
      "Choose an existing local project.",
    );
  try {
    const context = await readKernelReadonlyContext(root);
    if (context) {
      const record = {
        command: diagnostics ? "doctor" : "context",
        schema: 25,
        readOnly: true,
        legacyWrites: false,
        projectId: context.projectId,
        source: context.source,
        ...(diagnostics ? { integrity: "verified" } : { context }),
      };
      success(
        io,
        json,
        record,
        diagnostics
          ? "Schema 25 project verified read-only; no backup, repair or research write was performed."
          : JSON.stringify(record, null, 2),
      );
      return EXIT_CODES.success;
    }
    const opened = await openLegacyResearchReader({
      databasePath: resolve(root, ".sestina/state.sqlite"),
      readOnly: true,
      immutable: true,
    });
    if (!opened.ok) throw Error(opened.error.code);
    try {
      const projects = opened.value.listProjects();
      if (!projects.ok || projects.value.length !== 1 || !projects.value[0])
        throw Error("project_binding_inconsistent");
      const brief = opened.value.getBriefState(projects.value[0].id);
      if (!brief.ok) throw Error(brief.error.code);
      const record = {
        command: diagnostics ? "doctor" : "context",
        schema: opened.value.schemaVersion,
        readOnly: true,
        legacyWrites: false,
        projectId: projects.value[0].id,
        ...(diagnostics ? {} : { brief: brief.value ?? null }),
      };
      success(
        io,
        json,
        record,
        diagnostics
          ? "Historical project read without migration or writing. Use Research Room for an explicit migration."
          : JSON.stringify(record, null, 2),
      );
      return EXIT_CODES.success;
    } finally {
      opened.value.close();
    }
  } catch {
    return failure(
      io,
      json,
      EXIT_CODES.infrastructureFailure,
      "project_read_failed",
      "The project could not be verified for read-only access. Its files were preserved.",
    );
  }
}
