import type { CoreBriefState } from "@sestina/core";

type BriefVersion = CoreBriefState["version"];
type ScopeRule = BriefVersion["allowedChanges"][number];
type ScopeTarget = ScopeRule["target"];

export const RESEARCH_CONTENT_BOUNDARY = Object.freeze({
  kind: "untrusted_research_data" as const,
  authority: "none" as const,
  mayDirectTools: false as const,
  grantsPermissions: false as const,
  representsUserAcceptance: false as const,
  representsAdjudication: false as const,
  representsTaskCompletion: false as const,
});

export interface ResearchContextPayload {
  readonly schemaVersion: "1.0";
  readonly contentBoundary: typeof RESEARCH_CONTENT_BOUNDARY;
  readonly briefId: string;
  readonly versionId: string;
  readonly version: number;
  readonly recordVersion: number;
  readonly projectQuestion: string;
  readonly currentStage: string;
  readonly currentTask: string;
  readonly targetArtifacts: readonly string[];
  readonly fixedDecisions: BriefVersion["fixedDecisions"];
  readonly allowedChanges: BriefVersion["allowedChanges"];
  readonly forbiddenChanges: BriefVersion["forbiddenChanges"];
  readonly expectedDeltas: BriefVersion["expectedDeltas"];
  readonly evidenceBoundaries: BriefVersion["evidenceBoundaries"];
  readonly explicitNonGoals: readonly string[];
}

function projectScopeTarget(target: ScopeTarget): ScopeTarget {
  switch (target.kind) {
    case "artifact": return Object.freeze({ kind: target.kind, artifactId: target.artifactId });
    case "heading": return Object.freeze({ kind: target.kind, artifactId: target.artifactId, heading: target.heading });
    case "block": return Object.freeze({ kind: target.kind, artifactId: target.artifactId, blockId: target.blockId });
    case "project_path": return Object.freeze({ kind: target.kind, relativePath: target.relativePath });
  }
}

function projectScopeRule(rule: ScopeRule): ScopeRule {
  return Object.freeze({
    target: projectScopeTarget(rule.target),
    operations: Object.freeze([...rule.operations]),
  });
}

export function projectResearchContext(state: CoreBriefState): ResearchContextPayload {
  const version = state.version;
  const fixedDecisions = version.fixedDecisions.map((item) => Object.freeze({
    id: item.id,
    statement: item.statement,
    scope: projectScopeRule(item.scope),
  }));
  const expectedDeltas = version.expectedDeltas.map((item) => Object.freeze({
    id: item.id,
    statement: item.statement,
    scope: projectScopeRule(item.scope),
  }));
  const evidenceBoundaries = version.evidenceBoundaries.map((item) => Object.freeze({
    id: item.id,
    statement: item.statement,
    scope: projectScopeRule(item.scope),
    forbiddenInferenceKinds: Object.freeze([...item.forbiddenInferenceKinds]),
    ...(item.allowedSourceIds === undefined
      ? {}
      : { allowedSourceIds: Object.freeze([...item.allowedSourceIds]) }),
  }));

  return Object.freeze({
    schemaVersion: "1.0" as const,
    contentBoundary: RESEARCH_CONTENT_BOUNDARY,
    briefId: state.brief.id,
    versionId: version.id,
    version: version.versionNumber,
    recordVersion: state.brief.version,
    projectQuestion: version.projectQuestion,
    currentStage: version.currentStage,
    currentTask: version.currentTask,
    targetArtifacts: Object.freeze([...version.targetArtifacts]),
    fixedDecisions: Object.freeze(fixedDecisions),
    allowedChanges: Object.freeze(version.allowedChanges.map(projectScopeRule)),
    forbiddenChanges: Object.freeze(version.forbiddenChanges.map(projectScopeRule)),
    expectedDeltas: Object.freeze(expectedDeltas),
    evidenceBoundaries: Object.freeze(evidenceBoundaries),
    explicitNonGoals: Object.freeze([...version.explicitNonGoals]),
  });
}
