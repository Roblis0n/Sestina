import { join } from "node:path";
import { openDatabase, readSchemaVersion } from "@sestina/storage";
import { readKernelSnapshot } from "@sestina/research-store";
import {
  parseResearchDecision,
  parseResearchIssue,
  parseRevisionEpisode,
} from "@sestina/research";
import { openKernelProject } from "./kernel-migration.js";
import { projectBrief } from "./kernel-brief.js";
import { unwrapKernelDomain } from "./kernel-effects.js";

/** Read-only integrations get data, never a Kernel instance or Authority capability. */
export async function readKernelReadonlyContext(projectRoot: string) {
  const inspection = await openDatabase({
    path: join(projectRoot, ".sestina/state.sqlite"),
    readOnly: true,
    immutable: true,
    migrate: false,
  });
  let schema: number;
  try {
    schema = readSchemaVersion(inspection);
  } finally {
    inspection.close();
  }
  if (schema < 25) return undefined;
  if (schema !== 25) throw new Error("future_schema");
  const database = await openKernelProject(projectRoot, true);
  try {
    const project = database.get<{ project_id: string }>(
      "SELECT project_id FROM research_projects",
    );
    if (!project) throw new Error("invalid_project");
    const snapshot = readKernelSnapshot(database, project.project_id);
    const brief = projectBrief(snapshot);
    const decisions = snapshot.state.objects
      .filter((row) => row.kind === "decision")
      .map((row) => unwrapKernelDomain(parseResearchDecision(row.data)));
    const issues = snapshot.state.objects
      .filter((row) => row.kind === "issue")
      .map((row) => unwrapKernelDomain(parseResearchIssue(row.data)));
    const episodes = snapshot.state.objects
      .filter((row) => row.kind === "episode")
      .map((row) => unwrapKernelDomain(parseRevisionEpisode(row.data)));
    const episode = episodes.sort((a, b) => {
      const current = (status: string) =>
        [
          "active",
          "candidate_submitted",
          "reviewed",
          "user_action_required",
        ].includes(status)
          ? 1
          : 0;
      return (
        current(b.status) - current(a.status) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.id.localeCompare(a.id)
      );
    })[0];
    return {
      projectId: snapshot.head.projectId,
      source: {
        schema: 25 as const,
        projectStateRevision: snapshot.head.revision,
        canonicalHash: snapshot.head.canonicalHash,
      },
      brief:
        brief.brief && brief.active
          ? { brief: brief.brief, version: brief.active }
          : null,
      continuity: {
        currentEpisode: episode
          ? {
              id: episode.id,
              status: episode.status,
              artifactId: episode.artifactId,
              baselineRevisionId: episode.lockedStart.baselineRevisionId,
              candidateRevisionId: episode.candidateRevisionId ?? null,
            }
          : null,
        activeDecisions: decisions
          .filter(
            (item): item is typeof item & { status: "accepted" | "frozen" } =>
              item.status === "accepted" || item.status === "frozen",
          )
          .map((item) => ({
            id: item.id,
            status: item.status,
            statement: item.statement,
            reopenCondition: item.reopenConditions.join("; ") || null,
          })),
        relevantIssues: issues.map((item) => ({
          id: item.id,
          status: item.status,
          summary: item.summary,
          reopenCondition:
            [...item.transitions]
              .reverse()
              .map((row) => row.reason)
              .find((reason) => reason.includes("Invalidation condition:"))
              ?.split("Invalidation condition:")[1]
              ?.trim() ?? null,
          resolutionRecorded:
            item.resolution !== undefined || item.status === "waived",
        })),
      },
    };
  } finally {
    database.close();
  }
}
