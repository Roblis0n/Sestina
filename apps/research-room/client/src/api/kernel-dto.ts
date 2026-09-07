export type LocalJson =
  null | boolean | number | string | LocalJson[] | { [key: string]: LocalJson };
export interface ObjectReferenceDto {
  kind: "artifact" | "decision" | "evidence" | "issue";
  id: string;
  version: number;
}
export type SectionStateDto =
  | { status: "not_provided" | "provided" }
  | { status: "intentionally_empty"; publicReason: string };
export interface ScopeDto {
  target:
    | { kind: "project_path"; relativePath: string }
    | { kind: "artifact"; artifactId: string };
  operations: string[];
}
export interface RuleDto {
  id?: string;
  statement: string;
  scope: ScopeDto;
  forbiddenInferenceKinds?: string[];
  allowedSourceIds?: string[];
}
export interface ProgressiveDto {
  schemaVersion: "2.0.0";
  sections: Record<string, SectionStateDto>;
  acceptedDecisions: ObjectReferenceDto[];
  objectReferences?: ObjectReferenceDto[];
  knownUnknowns: {
    statement: string;
    importance: string;
    relatedObjectRefs: ObjectReferenceDto[];
    resolutionCondition?: string;
  }[];
  evidenceThresholds: {
    appliesTo: string;
    minimumSourceClass: string;
    acceptedInferenceCapacity: string[];
    requiredCorroboration?: number;
    publicReason: string;
  }[];
}
export interface BriefFieldsDto {
  projectQuestion: string;
  currentTask: string;
  currentStage: string;
  targetArtifacts: string[];
  fixedDecisions: RuleDto[];
  allowedChanges: ScopeDto[];
  forbiddenChanges: ScopeDto[];
  expectedDeltas: RuleDto[];
  evidenceBoundaries: RuleDto[];
  explicitNonGoals: string[];
  progressive?: ProgressiveDto;
}
export interface BriefVersionDto extends BriefFieldsDto {
  id: string;
  versionNumber: number;
  createdAt: string;
  supersedes?: string;
}
export interface BriefViewDto {
  coverage?: Record<string, {section:string; status:string; reason:string}[]>;
  objectLabels?: Record<string, string>;
  objectVersions?: ObjectReferenceDto[];
  fileProjection?: { status: string; source_revision: number } | null;
  projectId: string;
  projectStateRevision: number;
  active: BriefVersionDto | null;
  brief: {
    id: string;
    version: number;
    currentVersionId: string;
    versions: BriefVersionDto[];
  } | null;
  sections: Record<string, SectionStateDto>;
}
export interface KernelReviewDto {
  id: string;
  version: number;
  suggestion: string;
  status: string;
  baseProjectStateRevision: number;
  source: { kind: string; id: string | null };
  effectDraft: {
    objectVersions?: ObjectReferenceDto[];
    payload: LocalJson;
    preview: LocalJson;
    previewHash: string;
    authorityCommandId: string;
    invalidated?: boolean;
  } | null;
  attemptIds: string[];
  manifestId: string | null;
  terminalOutcome?: {resultingObjects: ObjectReferenceDto[]; receiptId:string | null} | null;
}
export interface KernelReviewViewDto {
  review: KernelReviewDto;
  projectStateRevision: number;
  staleReasons: string[];
  allowedNext: string[];
  attempts: {
    id: string;
    status: string;
    ordinal: number;
    assessmentHash: string | null;
    assessment: {
      publicSummary: string;
      envelope?: { assessment?: { findings: { publicRationale: string }[] } };
    } | null;
  }[];
  corrections: LocalJson[];
  manifest: LocalJson;
}
export interface RelationshipPageDto {
  items: (ObjectReferenceDto & {
    name: string;
    status: string;
    source: LocalJson;
    selectable: boolean;
  })[];
  nextCursor: string | null;
  projectStateRevision: number;
}
/** Limit and validate the transport tree before typed projections reach controls. */
export function requireLocalValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("invalid_payload");
  return value;
}
function localObject(value: unknown): Record<string, LocalJson> {
  const parsed=decodeLocalJson(value);
  if(parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_payload");
  return parsed;
}
export function decodeLocalJson(value: unknown, depth = 0): LocalJson {
  if (depth > 48) throw new Error("invalid_payload");
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (typeof value === "string" && value.length <= 1048576) return value;
  if (Array.isArray(value) && value.length <= 10000)
    return value.map((v) => decodeLocalJson(v, depth + 1));
  if (value && typeof value === "object" && Object.keys(value).length <= 10000)
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, decodeLocalJson(v, depth + 1)]),
    );
  throw new Error("invalid_payload");
}
export function decodeBriefView(value: unknown): BriefViewDto {
  const v = localObject(value);
  if (
    typeof v.projectId !== "string" ||
    !Number.isSafeInteger(v.projectStateRevision) ||
    !v.sections ||
    (v.active !== null &&
      (typeof localObject(v.active).currentTask !== "string" ||
        typeof localObject(v.active).projectQuestion !== "string" ||
        !Array.isArray(localObject(v.brief).versions)))
  )
    throw new Error("invalid_payload");
  return v as unknown as BriefViewDto;
}
export function decodeReview(value: unknown): KernelReviewDto {
  const v = localObject(value);
  if (
    typeof v.id !== "string" ||
    !Number.isSafeInteger(v.version) ||
    typeof v.suggestion !== "string" ||
    typeof v.status !== "string" ||
    !Array.isArray(v.attemptIds)
  )
    throw new Error("invalid_payload");
  return v as unknown as KernelReviewDto;
}
export function decodeReviewView(value: unknown): KernelReviewViewDto {
  const v = localObject(value);
  decodeReview(v.review);
  if (
    !Array.isArray(v.allowedNext) ||
    !Array.isArray(v.staleReasons) ||
    !Array.isArray(v.attempts)
  )
    throw new Error("invalid_payload");
  return v as unknown as KernelReviewViewDto;
}
