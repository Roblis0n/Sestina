import { parseResearchProject, type ResearchProject, type ResearchSource } from "@sestina/research";
import { safeTimestamp } from "./identity.js";
import type { LegacyProjectRow } from "./types.js";

export function mapLegacyProject(row: LegacyProjectRow, id: string, source: ResearchSource): ResearchProject | undefined {
  const at = safeTimestamp(row.createdAt);
  const parsed = parseResearchProject({ id, title: row.displayName, rootPath: ".", source, version: 1, createdAt: at, updatedAt: at });
  return parsed.ok ? parsed.value : undefined;
}
