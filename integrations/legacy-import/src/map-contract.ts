import {
  createImportedResearchBriefDraft,
  parseResearchArtifact,
  type IdFactory,
  type ResearchArtifact,
  type ResearchBrief,
  type ResearchSource,
} from "@sestina/research";
import { TaskContractSchema } from "@sestina/schema";
import type { LegacyContractRow } from "./types.js";

class FixedIds implements IdFactory {
  private index = 0;
  constructor(private readonly ids: readonly string[]) {}
  create(): string { return this.ids[this.index++] ?? ""; }
}

export function mapLegacyContract(
  row: LegacyContractRow,
  ids: { readonly projectId: string; readonly artifactId: string; readonly briefId: string; readonly briefVersionId: string; readonly expectedDeltaId: string },
  source: ResearchSource,
): { readonly artifact: ResearchArtifact; readonly brief: ResearchBrief } | undefined {
  let raw: unknown;
  try { raw = JSON.parse(row.data); } catch { return undefined; }
  const contract = TaskContractSchema.safeParse(raw);
  if (!contract.success) return undefined;
  const at = contract.data.createdAt;
  const artifact = parseResearchArtifact({
    id: ids.artifactId, projectId: ids.projectId, kind: "research_note",
    title: contract.data.title, source, version: 1, createdAt: at, branchHeads: [], revisions: [],
  });
  if (!artifact.ok) return undefined;
  const brief = createImportedResearchBriefDraft({
    projectId: ids.projectId,
    projectQuestion: contract.data.objective.primary,
    currentStage: "revision",
    currentTask: contract.data.title,
    targetArtifacts: [ids.artifactId],
    fixedDecisions: [],
    allowedChanges: [{ target: { kind: "artifact", artifactId: ids.artifactId }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [],
    expectedDeltas: [{ id: ids.expectedDeltaId, statement: contract.data.deliverables.map((value) => value.description).join("; ") || contract.data.objective.primary, scope: { target: { kind: "artifact", artifactId: ids.artifactId }, operations: ["add", "rewrite"] } }],
    evidenceBoundaries: [],
    explicitNonGoals: contract.data.scope.out.map((value) => value.statement),
    source,
  }, { clock: { now: () => new Date(at) }, idFactory: new FixedIds([ids.briefId, ids.briefVersionId]) });
  return brief.ok ? { artifact: artifact.value, brief: brief.value } : undefined;
}
