import type {
  AnalyzedReviewDto,
  AppealDetailDto,
  AppealManifestDto,
  AppealSummaryDto,
  AttentionDto,
  AppLanguage,
  AssessmentDto,
  BriefWorkspaceDto,
  ContextManifestDto,
  DecisionDetailDto,
  DecisionSummaryDto,
  DeliberationRoomDetailDto,
  DeliberationRoomSummaryDto,
  EvidenceDetailDto,
  EvidenceSummaryDto,
  EpisodeDetailDto,
  EpisodeSummaryDto,
  IssueDetailDto,
  IssueSummaryDto,
  ObjectReceiptDetailDto,
  ObjectReceiptSummaryDto,
  PreparedReviewDto,
  PreparedAppealSecondOpinionDto,
  PreparedDeliberationDto,
  PreparedDeliberationRetryDto,
  ProjectOverviewDto,
  ProjectOpenResultDto,
  ProviderStatusDto,
  ProviderConnectionTestDto,
  ResearchRoomReceiptDto,
  ResearchRoomStateDto,
  ResearchObjectKind,
  ResearchObjectSearchDto,
  SelectedDirectoryDto,
  SelectedDirectoryPreviewDto,
  StatusDto,
  WorkspacePage,
} from "./dto.js";

export class ApiPayloadError extends Error {
  readonly code: string;
  constructor(message: string, code = "invalid_payload") {
    super(message);
    this.name = "ApiPayloadError";
    this.code = code;
  }
}

function fail(path: string): never {
  throw new ApiPayloadError(`The local service returned an invalid ${path} payload.`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(path);
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) fail(path);
}

function requiredKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of keys) if (!(key in value)) fail(`${path}.${key}`);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path);
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path);
  return value;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path);
  return value;
}

function strings(value: unknown, path: string): readonly string[] {
  return array(value, path).map((item, index) => string(item, `${path}[${index}]`));
}

function language(value: unknown, path: string): AppLanguage {
  if (value !== "zh-CN" && value !== "en") fail(path);
  return value;
}

function findingSeverity(value: unknown, path: string): "info" | "warning" | "error" {
  switch (string(value, path)) {
    case "info": return "info";
    case "warning": return "warning";
    case "error": return "error";
    default: return fail(path);
  }
}

export function decodeApiEnvelope<T>(value: unknown, decode: (input: unknown) => T): T {
  const envelope = record(value, "API envelope");
  if (envelope.ok === true) {
    exactKeys(envelope, ["ok", "value"], "API success envelope");
    return decode(envelope.value);
  }
  if (envelope.ok === false) {
    exactKeys(envelope, ["error", "ok"], "API error envelope");
    const error = record(envelope.error, "API error");
    exactKeys(error, ["code", "message"], "API error");
    throw new ApiPayloadError(string(error.message, "API error message"), string(error.code, "API error code"));
  }
  return fail("API envelope");
}

export function decodeStatus(value: unknown): StatusDto {
  const status = record(value, "status");
  allowedKeys(status, ["directoryPickerAvailable", "languagePreference", "localOnly", "project", "projectOpen", "projectSetupRequired", "sessionToken", "telemetry"], "status");
  if (status.localOnly !== true || status.telemetry !== false) fail("status locality");
  return {
    localOnly: true,
    telemetry: false,
    projectOpen: boolean(status.projectOpen, "status.projectOpen"),
    ...(typeof status.projectSetupRequired === "boolean" ? { projectSetupRequired: status.projectSetupRequired } : {}),
    ...(status.project === undefined ? {} : { project: decodeProject(status.project, "status.project") }),
    directoryPickerAvailable: boolean(status.directoryPickerAvailable, "status.directoryPickerAvailable"),
    languagePreference: status.languagePreference === null ? null : language(status.languagePreference, "status.languagePreference"),
    sessionToken: string(status.sessionToken, "status.sessionToken"),
  };
}

export function decodeProviderConnectionTest(value: unknown): ProviderConnectionTestDto {
  const result = record(value, "Provider connection test");
  exactKeys(result, ["endpoint", "httpStatus", "locality", "model", "providerId", "reachable", "requestKind"], "Provider connection test");
  if (result.reachable !== true || result.requestKind !== "metadata_only_no_research_context" || !["local", "external"].includes(String(result.locality))) fail("Provider connection test contract");
  for (const key of ["endpoint", "model", "providerId"] as const) string(result[key], `Provider connection test.${key}`);
  number(result.httpStatus, "Provider connection test.httpStatus");
  return result as unknown as ProviderConnectionTestDto;
}

function decodeProject(value: unknown, path: string): { readonly id: string; readonly title: string } {
  const project = record(value, path);
  if (Object.keys(project).some((key) => key !== "id" && key !== "title")) fail(path);
  return { id: string(project.id, `${path}.id`), title: string(project.title, `${path}.title`) };
}

export function decodeProjectOpenResult(value: unknown): ProjectOpenResultDto {
  const opened = record(value, "project open result");
  exactKeys(opened, ["directoryScanPerformed", "initialized", "localOnly", "pathPersisted", "project", "setupRequired"], "project open result");
  if (opened.localOnly !== true || opened.pathPersisted !== false || opened.directoryScanPerformed !== false) fail("project open safety contract");
  return {
    project: decodeProject(opened.project, "project open result.project"),
    initialized: boolean(opened.initialized, "project open result.initialized"),
    setupRequired: boolean(opened.setupRequired, "project open result.setupRequired"),
    localOnly: true,
    pathPersisted: false,
    directoryScanPerformed: false,
  };
}

export function decodeSelectedDirectory(value: unknown): SelectedDirectoryDto {
  const selected = record(value, "directory selection");
  if (selected.selected === false) {
    exactKeys(selected, ["selected"], "directory selection cancellation");
    return { selected: false };
  }
  if (selected.selected !== true) fail("directory selection.selected");
  const opened = {
    directoryScanPerformed: selected.directoryScanPerformed,
    initialized: selected.initialized,
    localOnly: selected.localOnly,
    pathPersisted: selected.pathPersisted,
    project: selected.project,
    setupRequired: selected.setupRequired,
  };
  return { selected: true, ...decodeProjectOpenResult(opened) };
}

export function decodeDirectoryPickerCancellation(value: unknown): { readonly cancelRequested: boolean } {
  const cancellation = record(value, "directory picker cancellation");
  exactKeys(cancellation, ["cancelRequested"], "directory picker cancellation");
  if (typeof cancellation.cancelRequested !== "boolean") fail("directory picker cancellation.cancelRequested");
  return { cancelRequested: cancellation.cancelRequested };
}

export function decodeSelectedDirectoryPreview(value: unknown): SelectedDirectoryPreviewDto {
  const preview = record(value, "directory selection preview");
  if (preview.selected === false) {
    exactKeys(preview, ["selected"], "directory selection preview cancellation");
    return { selected: false };
  }
  if (preview.selected !== true) fail("directory selection preview.selected");
  if (preview.initializationRequired === false) {
    const opened = {
      directoryScanPerformed: preview.directoryScanPerformed,
      initialized: preview.initialized,
      localOnly: preview.localOnly,
      pathPersisted: preview.pathPersisted,
      project: preview.project,
      setupRequired: preview.setupRequired,
    };
    return { selected: true, initializationRequired: false, ...decodeProjectOpenResult(opened) };
  }
  if (preview.initializationRequired !== true) fail("directory selection preview.initializationRequired");
  exactKeys(preview, ["confirmationNonce", "creates", "directoryScanPerformed", "initializationRequired", "localOnly", "pathPersisted", "projectTitle", "selected", "writesPerformed"], "directory selection initialization preview");
  if (preview.localOnly !== true || preview.pathPersisted !== false || preview.directoryScanPerformed !== false || preview.writesPerformed !== false) fail("directory selection initialization safety contract");
  return {
    selected: true,
    initializationRequired: true,
    projectTitle: string(preview.projectTitle, "directory selection preview.projectTitle"),
    confirmationNonce: string(preview.confirmationNonce, "directory selection preview.confirmationNonce"),
    localOnly: true,
    pathPersisted: false,
    directoryScanPerformed: false,
    writesPerformed: false,
    creates: strings(preview.creates, "directory selection preview.creates"),
  };
}

function decodeReceipt(value: unknown, path: string): ResearchRoomReceiptDto {
  const receipt = record(value, path);
  const disposition = record(receipt.disposition, `${path}.disposition`);
  const kind = string(disposition.kind, `${path}.disposition.kind`);
  if (!["accepted", "rejected", "modified_accepted", "deferred", "direction_changed"].includes(kind)) fail(`${path}.disposition.kind`);
  const rollback = record(receipt.rollback, `${path}.rollback`);
  const semantic = receipt.semanticJudge === undefined ? undefined : record(receipt.semanticJudge, `${path}.semanticJudge`);
  return {
    id: string(receipt.id, `${path}.id`),
    version: number(receipt.version, `${path}.version`),
    status: string(receipt.status, `${path}.status`),
    receiptHash: string(receipt.receiptHash, `${path}.receiptHash`),
    disposition: { kind: kind as ResearchRoomReceiptDto["disposition"]["kind"], ...(typeof disposition.reason === "string" ? { reason: disposition.reason } : {}) },
    rollback: { available: boolean(rollback.available, `${path}.rollback.available`), ...(typeof rollback.reason === "string" ? { reason: rollback.reason } : {}) },
    ...(receipt.providerStatus === "semantic_ready" || receipt.providerStatus === "ledger_only" ? { providerStatus: receipt.providerStatus } : {}),
    ...(semantic ? {
      semanticJudge: {
        assessments: array(semantic.assessments, `${path}.semanticJudge.assessments`).map((item, index) => decodeAssessment(item, `${path}.semanticJudge.assessments[${index}]`)),
        responseHashes: { requestHash: string(record(semantic.responseHashes, `${path}.semanticJudge.responseHashes`).requestHash, `${path}.semanticJudge.responseHashes.requestHash`) },
        ...(typeof semantic.derivation === "string" ? { derivation: semantic.derivation } : {}),
      },
    } : {}),
  };
}

export function decodeResearchRoomState(value: unknown): ResearchRoomStateDto {
  const state = record(value, "research room state");
  const brief = record(state.brief, "research room state.brief");
  const fixedDecisions = array(brief.fixedDecisions, "research room state.brief.fixedDecisions").map((item, index) => ({ statement: string(record(item, `fixedDecisions[${index}]`).statement, `fixedDecisions[${index}].statement`) }));
  const decisions = array(state.decisions, "research room state.decisions").map((item, index) => { const row = record(item, `decisions[${index}]`); return { statement: string(row.statement, `decisions[${index}].statement`), status: string(row.status, `decisions[${index}].status`) }; });
  const issues = array(state.issues, "research room state.issues").map((item, index) => { const row = record(item, `issues[${index}]`); return { summary: string(row.summary, `issues[${index}].summary`), status: string(row.status, `issues[${index}].status`) }; });
  const episode = state.currentEpisode === undefined || state.currentEpisode === null ? undefined : record(state.currentEpisode, "research room state.currentEpisode");
  return {
    project: decodeProject(state.project, "research room state.project"),
    brief: {
      projectQuestion: string(brief.projectQuestion, "research room state.brief.projectQuestion"),
      currentStage: string(brief.currentStage, "research room state.brief.currentStage"),
      currentTask: string(brief.currentTask, "research room state.brief.currentTask"),
      fixedDecisions,
    },
    decisions,
    issues,
    ...(episode ? { currentEpisode: { id: string(episode.id, "currentEpisode.id"), status: string(episode.status, "currentEpisode.status") } } : {}),
    receipts: array(state.receipts, "research room state.receipts").map((item, index) => decodeReceipt(item, `receipts[${index}]`)),
  };
}

function decodeManifest(value: unknown, path: string): ContextManifestDto {
  const manifest = record(value, path);
  const fields = array(manifest.fields, `${path}.fields`).map((item, index) => { const field = record(item, `${path}.fields[${index}]`); return { category: string(field.category, `${path}.fields[${index}].category`), source: string(field.source, `${path}.fields[${index}].source`), sensitivity: string(field.sensitivity, `${path}.fields[${index}].sensitivity`) }; });
  const judge = manifest.semanticJudge === undefined ? undefined : record(manifest.semanticJudge, `${path}.semanticJudge`);
  return {
    fields,
    networkRequired: boolean(manifest.networkRequired, `${path}.networkRequired`),
    networkUsed: boolean(manifest.networkUsed, `${path}.networkUsed`),
    sendStatus: string(manifest.sendStatus, `${path}.sendStatus`),
    countsAsExternalEvidence: manifest.countsAsExternalEvidence === false ? false : fail(`${path}.countsAsExternalEvidence`),
    ...(judge ? { semanticJudge: decodeSemanticJudgeManifest(judge, `${path}.semanticJudge`) } : {}),
  };
}

function decodeSemanticJudgeManifest(judge: Record<string, unknown>, path: string) {
  const provider = record(judge.provider, `${path}.provider`);
  const request = record(judge.request, `${path}.request`);
  const versionHash = (value: unknown, childPath: string) => { const row = record(value, childPath); return { version: string(row.version, `${childPath}.version`), hash: string(row.hash, `${childPath}.hash`) }; };
  const locality = string(provider.locality, `${path}.provider.locality`);
  if (locality !== "local" && locality !== "external") fail(`${path}.provider.locality`);
  return {
    provider: { id: string(provider.id, `${path}.provider.id`), model: string(provider.model, `${path}.provider.model`), locality },
    request: {
      endpoint: string(request.endpoint, `${path}.request.endpoint`),
      requestBodyBytes: number(request.requestBodyBytes, `${path}.request.requestBodyBytes`),
      requestHash: string(request.requestHash, `${path}.request.requestHash`),
      requestBodyHash: string(request.requestBodyHash, `${path}.request.requestBodyHash`),
      requestBody: string(request.requestBody, `${path}.request.requestBody`),
    },
    protocol: versionHash(judge.protocol, `${path}.protocol`),
    prompt: versionHash(judge.prompt, `${path}.prompt`),
    rubric: versionHash(judge.rubric, `${path}.rubric`),
    excludedFields: strings(judge.excludedFields, `${path}.excludedFields`),
  } as const;
}

export function decodePreparedReview(value: unknown): PreparedReviewDto {
  const prepared = record(value, "prepared review");
  if (prepared.contextManifestVisible !== true) fail("prepared review.contextManifestVisible");
  return {
    reviewId: string(prepared.reviewId, "prepared review.reviewId"),
    confirmationNonce: string(prepared.confirmationNonce, "prepared review.confirmationNonce"),
    manifestHash: string(prepared.manifestHash, "prepared review.manifestHash"),
    contextManifestVisible: true,
    manifest: decodeManifest(prepared.manifest, "prepared review.manifest"),
  };
}

function decodeAssessment(value: unknown, path: string): AssessmentDto {
  const assessment = record(value, path);
  const verdict = string(assessment.verdict, `${path}.verdict`);
  if (verdict !== "positive" && verdict !== "negative" && verdict !== "unknown") fail(`${path}.verdict`);
  return {
    criterionId: string(assessment.criterionId, `${path}.criterionId`),
    verdict,
    publicRationale: string(assessment.publicRationale, `${path}.publicRationale`),
    ...(typeof assessment.uncertainty === "string" ? { uncertainty: assessment.uncertainty } : {}),
    missingContext: strings(assessment.missingContext, `${path}.missingContext`),
    evidenceSpans: array(assessment.evidenceSpans, `${path}.evidenceSpans`).map((item, index) => { const span = record(item, `${path}.evidenceSpans[${index}]`); return { quote: string(span.quote, `${path}.evidenceSpans[${index}].quote`), start: number(span.start, `${path}.evidenceSpans[${index}].start`), end: number(span.end, `${path}.evidenceSpans[${index}].end`), quoteHash: string(span.quoteHash, `${path}.evidenceSpans[${index}].quoteHash`) }; }),
    ...(typeof assessment.minimalCorrection === "string" ? { minimalCorrection: assessment.minimalCorrection } : {}),
  };
}

export function decodeAnalyzedReview(value: unknown): AnalyzedReviewDto {
  const analyzed = record(value, "analyzed review");
  const providerStatus = string(analyzed.providerStatus, "analyzed review.providerStatus");
  if (providerStatus !== "semantic_ready" && providerStatus !== "ledger_only") fail("analyzed review.providerStatus");
  const stateBinding = record(analyzed.stateBinding, "analyzed review.stateBinding");
  const analysis = record(analyzed.analysis, "analyzed review.analysis");
  const delta = record(analysis.argumentDelta, "analyzed review.analysis.argumentDelta");
  const findings = array(analysis.findings, "analyzed review.analysis.findings").map((item, index) => { const finding = record(item, `analysis.findings[${index}]`); return { kind: string(finding.kind, `analysis.findings[${index}].kind`), summary: string(finding.summary, `analysis.findings[${index}].summary`) }; });
  const judge = analyzed.semanticJudge === undefined ? undefined : record(analyzed.semanticJudge, "analyzed review.semanticJudge");
  const assessments = judge ? array(judge.assessments, "analyzed review.semanticJudge.assessments").map((item, index) => decodeAssessment(item, `semanticJudge.assessments[${index}]`)) : [];
  if (providerStatus === "semantic_ready" && (!judge || assessments.length !== 9)) fail("analyzed review.semanticJudge complete assessments");
  const judgeFindings = judge ? array(judge.findings, "analyzed review.semanticJudge.findings").map((item, index) => {
    const path = `semanticJudge.findings[${index}]`;
    const finding = record(item, path);
    const severity = findingSeverity(finding.severity, `${path}.severity`);
    if (finding.authority !== "model_proposed") fail(`${path}.authority`);
    return {
      id: string(finding.id, `${path}.id`),
      kind: string(finding.kind, `${path}.kind`),
      severity,
      rationale: string(finding.rationale, `${path}.rationale`),
      minimumRecovery: string(finding.minimumRecovery, `${path}.minimumRecovery`),
      decisionIds: strings(finding.decisionIds, `${path}.decisionIds`),
      issueIds: strings(finding.issueIds, `${path}.issueIds`),
      authority: "model_proposed" as const,
    };
  }) : [];
  const reasonable = judge ? record(judge.reasonableIncrement, "semanticJudge.reasonableIncrement") : undefined;
  return {
    reviewId: string(analyzed.reviewId, "analyzed review.reviewId"),
    authorityNonce: string(analyzed.authorityNonce, "analyzed review.authorityNonce"),
    stateBinding,
    providerStatus,
    ...(typeof analyzed.ledgerOnlyReason === "string" ? { ledgerOnlyReason: analyzed.ledgerOnlyReason } : {}),
    manifest: decodeManifest(analyzed.manifest, "analyzed review.manifest"),
    ...(judge && reasonable ? { semanticJudge: { assessments, findings: judgeFindings, reasonableIncrement: { status: string(reasonable.status, "reasonableIncrement.status"), blockingCriteria: strings(reasonable.blockingCriteria, "reasonableIncrement.blockingCriteria") } } } : {}),
    analysis: {
      findings,
      argumentDelta: { genuineAdditions: strings(delta.genuineAdditions, "argumentDelta.genuineAdditions"), summary: string(delta.summary, "argumentDelta.summary") },
      alternativeExplanations: strings(analysis.alternativeExplanations, "analysis.alternativeExplanations"),
      unknowns: strings(analysis.unknowns, "analysis.unknowns"),
      unproven: strings(analysis.unproven, "analysis.unproven"),
      minimalCorrection: typeof analysis.minimalCorrection === "string" ? analysis.minimalCorrection : "",
    },
  };
}

export function decodeProviderStatus(value: unknown): ProviderStatusDto {
  const status = record(value, "provider status");
  const mode = string(status.mode, "provider status.mode");
  if (mode !== "configured" && mode !== "offline_ledger") fail("provider status.mode");
  const config = status.config === undefined ? undefined : record(status.config, "provider status.config");
  if (mode === "configured" && !config && status.injected !== true) fail("provider status.config");
  return {
    mode,
    ...(typeof status.injected === "boolean" ? { injected: status.injected } : {}),
    ...(typeof status.secretConfigured === "boolean" ? { secretConfigured: status.secretConfigured } : {}),
    ...(typeof status.projectReopenRequired === "boolean" ? { projectReopenRequired: status.projectReopenRequired } : {}),
    ...(config ? { config: { family: config.family === "openai_compatible" ? "openai_compatible" : fail("provider status.config.family"), providerId: string(config.providerId, "provider status.config.providerId"), model: string(config.model, "provider status.config.model"), baseUrl: string(config.baseUrl, "provider status.config.baseUrl"), locality: config.locality === "local" || config.locality === "external" ? config.locality : fail("provider status.config.locality"), generation: number(config.generation, "provider status.config.generation"), timeoutMs: number(config.timeoutMs, "provider status.config.timeoutMs"), ...(typeof config.maxOutputTokens === "number" ? { maxOutputTokens: config.maxOutputTokens } : {}) } } : {}),
  };
}

export function decodeLanguage(value: unknown): { readonly language: AppLanguage } {
  const result = record(value, "language preference");
  exactKeys(result, ["language"], "language preference");
  return { language: language(result.language, "language preference.language") };
}

export function decodeReceiptResult(value: unknown): ResearchRoomReceiptDto {
  return decodeReceipt(value, "receipt");
}

const WORKSPACE_SCHEMA_VERSION = "1.0.0";
const FORBIDDEN_PROJECTION_KEYS = new Set(["apiKey", "databasePath", "providerRawResponse", "rawProviderResponse", "rootPath", "secret", "stack"]);

function requireSchema(value: Record<string, unknown>, path: string): void {
  if (value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) fail(`${path}.schemaVersion`);
}

function safeTree(value: unknown, path: string, depth = 0): void {
  if (depth > 12) fail(path);
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { value.forEach((item, index) => { safeTree(item, `${path}[${index}]`, depth + 1); }); return; }
  const object = record(value, path);
  for (const [key, item] of Object.entries(object)) {
    if (FORBIDDEN_PROJECTION_KEYS.has(key)) fail(`${path}.${key}`);
    safeTree(item, `${path}.${key}`, depth + 1);
  }
}

function provenance(value: unknown, path: string): void {
  const item = record(value, path);
  exactKeys(item, ["actorKind", "authority", "recordedAt"], path);
  string(item.actorKind, `${path}.actorKind`); string(item.authority, `${path}.authority`); string(item.recordedAt, `${path}.recordedAt`);
}

function scope(value: unknown, path: string): void {
  const item = record(value, path); const kind = string(item.kind, `${path}.kind`);
  if (kind === "project") exactKeys(item, ["kind"], path);
  else if (kind === "artifact") { exactKeys(item, ["artifactId", "kind"], path); string(item.artifactId, `${path}.artifactId`); }
  else if (kind === "brief") { exactKeys(item, ["briefVersionId", "kind"], path); string(item.briefVersionId, `${path}.briefVersionId`); }
  else if (kind === "issue") { exactKeys(item, ["issueId", "kind"], path); string(item.issueId, `${path}.issueId`); }
  else fail(`${path}.kind`);
}

function decisionSummaryDecoder(value: unknown, path: string): DecisionSummaryDto {
  const item = record(value, path);
  allowedKeys(item, ["active", "createdAt", "effectiveBriefVersionId", "id", "kind", "provenance", "rationale", "referencedByCurrentBrief", "reopenConditions", "scope", "statement", "status", "supersededByDecisionId", "supersedesDecisionId", "updatedAt", "version"], path);
  for (const required of ["active", "createdAt", "effectiveBriefVersionId", "id", "kind", "provenance", "rationale", "referencedByCurrentBrief", "reopenConditions", "scope", "statement", "status", "updatedAt", "version"] as const) if (!(required in item)) fail(`${path}.${required}`);
  if (item.kind !== "decision") fail(`${path}.kind`); scope(item.scope, `${path}.scope`); provenance(item.provenance, `${path}.provenance`);
  for (const key of ["createdAt", "effectiveBriefVersionId", "id", "rationale", "statement", "status", "updatedAt"] as const) string(item[key], `${path}.${key}`);
  if (item.supersedesDecisionId !== undefined) string(item.supersedesDecisionId, `${path}.supersedesDecisionId`); if (item.supersededByDecisionId !== undefined) string(item.supersededByDecisionId, `${path}.supersededByDecisionId`);
  strings(item.reopenConditions, `${path}.reopenConditions`); boolean(item.active, `${path}.active`); boolean(item.referencedByCurrentBrief, `${path}.referencedByCurrentBrief`); number(item.version, `${path}.version`);
  return item as unknown as DecisionSummaryDto;
}

function issueSummaryDecoder(value: unknown, path: string): IssueSummaryDto {
  const item = record(value, path);
  exactKeys(item, ["createdAt", "fingerprint", "id", "issueKind", "kind", "provenance", "recurrenceCount", "requiresUserAction", "status", "summary", "updatedAt", "version", "violatedCriterion"], path);
  if (item.kind !== "issue") fail(`${path}.kind`); provenance(item.provenance, `${path}.provenance`);
  for (const key of ["createdAt", "fingerprint", "id", "issueKind", "status", "summary", "updatedAt", "violatedCriterion"] as const) string(item[key], `${path}.${key}`);
  number(item.recurrenceCount, `${path}.recurrenceCount`); boolean(item.requiresUserAction, `${path}.requiresUserAction`); number(item.version, `${path}.version`);
  return item as unknown as IssueSummaryDto;
}

function evidenceSummaryDecoder(value: unknown, path: string): EvidenceSummaryDto {
  const item = record(value, path);
  allowedKeys(item, ["artifactId", "evidenceKind", "id", "inferenceCapacity", "kind", "provenance", "revisionId", "state", "summary", "version"], path);
  for (const required of ["evidenceKind", "id", "inferenceCapacity", "kind", "provenance", "state", "summary", "version"] as const) if (!(required in item)) fail(`${path}.${required}`);
  if (item.kind !== "evidence") fail(`${path}.kind`); provenance(item.provenance, `${path}.provenance`);
  for (const key of ["evidenceKind", "id", "inferenceCapacity", "state", "summary"] as const) string(item[key], `${path}.${key}`);
  if (item.artifactId !== undefined) string(item.artifactId, `${path}.artifactId`); if (item.revisionId !== undefined) string(item.revisionId, `${path}.revisionId`); number(item.version, `${path}.version`);
  return item as unknown as EvidenceSummaryDto;
}

function episodeSummaryDecoder(value: unknown, path: string): EpisodeSummaryDto {
  const item = record(value, path);
  exactKeys(item, ["artifactId", "createdAt", "id", "kind", "provenance", "status", "updatedAt", "version"], path);
  if (item.kind !== "episode") fail(`${path}.kind`); provenance(item.provenance, `${path}.provenance`);
  for (const key of ["artifactId", "createdAt", "id", "status", "updatedAt"] as const) string(item[key], `${path}.${key}`); number(item.version, `${path}.version`);
  return item as unknown as EpisodeSummaryDto;
}

function objectReceiptSummaryDecoder(value: unknown, path: string): ObjectReceiptSummaryDto {
  const item = record(value, path);
  allowedKeys(item, ["createdAt", "disposition", "evidenceClass", "id", "kind", "providerStatus", "receiptHash", "reviewId", "rollback", "sourceEpisodeId", "status", "updatedAt", "version"], path);
  for (const required of ["createdAt", "disposition", "evidenceClass", "id", "kind", "providerStatus", "receiptHash", "reviewId", "rollback", "status", "updatedAt", "version"] as const) if (!(required in item)) fail(`${path}.${required}`);
  if (item.kind !== "receipt") fail(`${path}.kind`);
  for (const key of ["createdAt", "evidenceClass", "id", "providerStatus", "receiptHash", "reviewId", "status", "updatedAt"] as const) string(item[key], `${path}.${key}`);
  if (item.sourceEpisodeId !== undefined) string(item.sourceEpisodeId, `${path}.sourceEpisodeId`); number(item.version, `${path}.version`); safeTree(item.disposition, `${path}.disposition`); safeTree(item.rollback, `${path}.rollback`);
  return item as unknown as ObjectReceiptSummaryDto;
}

const APPEAL_STATUSES = ["draft", "recorded", "awaiting_send_confirmation", "second_opinion_running", "second_opinion_ready", "appeal_record_only", "waiting_user_resolution", "provider_failed", "cancelled", "stale_conflicted", "resolved"] as const;
const DELIBERATION_STATUSES = ["draft", "context_prepared", "awaiting_manifest_confirmation", "blind_round_running", "reveal_ready", "difference_review", "challenge_prepared", "challenge_running", "waiting_user_resolution", "partial", "retry_prepared", "retry_running", "failed", "cancelled", "stale_conflicted", "resolved", "closed"] as const;

function appealSummaryDecoder(value: unknown, path: string, detail = false): AppealSummaryDto {
  const item = record(value, path);
  const summaryKeys = ["attemptCount", "createdAt", "criterionId", "disagreement", "findingId", "id", "kind", "resolutionCount", "reviewId", "sourceReceiptId", "status", "updatedAt", "version"] as const;
  if (!detail) exactKeys(item, summaryKeys, path); else requiredKeys(item, summaryKeys, path);
  if (item.kind !== "appeal" || !APPEAL_STATUSES.includes(item.status as (typeof APPEAL_STATUSES)[number])) fail(`${path}.kind`);
  for (const key of ["createdAt", "criterionId", "disagreement", "findingId", "id", "reviewId", "sourceReceiptId", "status", "updatedAt"] as const) string(item[key], `${path}.${key}`);
  for (const key of ["attemptCount", "resolutionCount", "version"] as const) number(item[key], `${path}.${key}`);
  return item as unknown as AppealSummaryDto;
}

function deliberationSummaryDecoder(value: unknown, path: string, detail = false): DeliberationRoomSummaryDto {
  const item = record(value, path);
  const summaryKeys = ["challengeStatus", "createdAt", "differenceSummaryAvailable", "id", "kind", "manualOpinionCount", "participantStates", "providerCallCount", "providerCallLimit", "providerReadiness", "resolutionCount", "retryStatus", "source", "status", "title", "updatedAt", "version"] as const;
  if (!detail) allowedKeys(item, summaryKeys, path);
  for (const required of ["createdAt", "differenceSummaryAvailable", "id", "kind", "manualOpinionCount", "participantStates", "providerCallCount", "providerCallLimit", "providerReadiness", "resolutionCount", "source", "status", "title", "updatedAt", "version"] as const) if (!(required in item)) fail(`${path}.${required}`);
  if (item.kind !== "deliberation_room" || !DELIBERATION_STATUSES.includes(item.status as (typeof DELIBERATION_STATUSES)[number]) || !["configured_distinct", "blocked_missing_provider", "same_runtime_not_mutually_independent"].includes(String(item.providerReadiness))) fail(`${path}.kind`);
  for (const key of ["createdAt", "id", "providerReadiness", "status", "title", "updatedAt"] as const) string(item[key], `${path}.${key}`);
  for (const key of ["manualOpinionCount", "providerCallCount", "providerCallLimit", "resolutionCount", "version"] as const) number(item[key], `${path}.${key}`); if (item.providerCallLimit !== 4 || Number(item.providerCallCount) > 4) fail(`${path}.providerCallLimit`);
  boolean(item.differenceSummaryAvailable, `${path}.differenceSummaryAvailable`);
  if (item.challengeStatus !== undefined) string(item.challengeStatus, `${path}.challengeStatus`);
  if (item.retryStatus !== undefined) string(item.retryStatus, `${path}.retryStatus`);
  const source = record(item.source, `${path}.source`); exactKeys(source, ["kind", "objectId", "objectVersion", "projectId", "question", "sourceHash"], `${path}.source`); for (const key of ["kind", "objectId", "projectId", "question", "sourceHash"] as const) string(source[key], `${path}.source.${key}`); number(source.objectVersion, `${path}.source.objectVersion`);
  const participants = array(item.participantStates, `${path}.participantStates`); if (participants.length !== 2) fail(`${path}.participantStates`);
  participants.forEach((raw, index) => { const participant = record(raw, `${path}.participantStates[${index}]`); exactKeys(participant, ["model", "providerId", "slot", "status"], `${path}.participantStates[${index}]`); for (const key of ["model", "providerId", "slot", "status"] as const) string(participant[key], `${path}.participantStates[${index}].${key}`); if (participant.slot !== (index === 0 ? "a" : "b")) fail(`${path}.participantStates[${index}].slot`); });
  return item as unknown as DeliberationRoomSummaryDto;
}

export function decodeWorkspacePage(value: unknown, kind: ResearchObjectKind): WorkspacePage<DecisionSummaryDto | IssueSummaryDto | EvidenceSummaryDto | EpisodeSummaryDto | ObjectReceiptSummaryDto | AppealSummaryDto | DeliberationRoomSummaryDto> {
  const page = record(value, `${kind} page`);
  allowedKeys(page, ["datasetVersion", "items", "nextCursor", "projectId", "schemaVersion"], `${kind} page`);
  for (const required of ["datasetVersion", "items", "projectId", "schemaVersion"] as const) if (!(required in page)) fail(`${kind} page.${required}`);
  requireSchema(page, `${kind} page`); string(page.projectId, `${kind} page.projectId`); string(page.datasetVersion, `${kind} page.datasetVersion`);
  if (page.nextCursor !== undefined) string(page.nextCursor, `${kind} page.nextCursor`);
  const items = array(page.items, `${kind} page.items`).map((item, index) => kind === "decision" ? decisionSummaryDecoder(item, `${kind} page.items[${index}]`) : kind === "issue" ? issueSummaryDecoder(item, `${kind} page.items[${index}]`) : kind === "evidence" ? evidenceSummaryDecoder(item, `${kind} page.items[${index}]`) : kind === "episode" ? episodeSummaryDecoder(item, `${kind} page.items[${index}]`) : kind === "receipt" ? objectReceiptSummaryDecoder(item, `${kind} page.items[${index}]`) : kind === "appeal" ? appealSummaryDecoder(item, `${kind} page.items[${index}]`) : deliberationSummaryDecoder(item, `${kind} page.items[${index}]`));
  return { schemaVersion: "1.0.0", projectId: page.projectId as string, datasetVersion: page.datasetVersion as string, items, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor as string }) };
}

function attentionItem(value: unknown, path: string): void {
  const item = record(value, path); exactKeys(item, ["createdAt", "href", "id", "kind", "primaryAction", "reason", "severity", "sourceObject", "title", "valid"], path);
  for (const key of ["createdAt", "href", "id", "kind", "primaryAction", "reason", "severity", "title"] as const) string(item[key], `${path}.${key}`);
  if (item.valid !== true) fail(`${path}.valid`);
  const sourceObject = record(item.sourceObject, `${path}.sourceObject`); exactKeys(sourceObject, ["id", "kind"], `${path}.sourceObject`); string(sourceObject.id, `${path}.sourceObject.id`); string(sourceObject.kind, `${path}.sourceObject.kind`);
  if (!(item.href as string).startsWith("/project/")) fail(`${path}.href`);
}

export function decodeProjectOverview(value: unknown): ProjectOverviewDto {
  const overview = record(value, "project overview"); allowedKeys(overview, ["attention", "brief", "counts", "currentEpisode", "latestReceipt", "project", "providerStatus", "recentChanges", "schemaVersion", "statuses"], "project overview"); for (const required of ["attention", "brief", "counts", "project", "providerStatus", "recentChanges", "schemaVersion", "statuses"] as const) if (!(required in overview)) fail(`project overview.${required}`); requireSchema(overview, "project overview");
  const project = record(overview.project, "project overview.project"); exactKeys(project, ["id", "title", "updatedAt", "version"], "project overview.project"); string(project.id, "project overview.project.id"); string(project.title, "project overview.project.title"); string(project.updatedAt, "project overview.project.updatedAt"); number(project.version, "project overview.project.version");
  const brief = record(overview.brief, "project overview.brief"); exactKeys(brief, ["id", "question", "stage", "task", "versionId", "versionNumber"], "project overview.brief"); for (const key of ["id", "question", "stage", "task", "versionId"] as const) string(brief[key], `project overview.brief.${key}`); number(brief.versionNumber, "project overview.brief.versionNumber");
  if (overview.providerStatus !== "configured" && overview.providerStatus !== "ledger_only") fail("project overview.providerStatus");
  const counts = record(overview.counts, "project overview.counts"); exactKeys(counts, ["appeals", "decisions", "deliberationRooms", "episodes", "evidence", "issues", "receipts"], "project overview.counts"); Object.entries(counts).forEach(([key, item]) => number(item, `project overview.counts.${key}`));
  const statuses = record(overview.statuses, "project overview.statuses"); exactKeys(statuses, ["appeals", "decisions", "deliberationRooms", "episodes", "evidence", "issues", "receipts"], "project overview.statuses"); safeTree(statuses, "project overview.statuses");
  const attention = record(overview.attention, "project overview.attention"); exactKeys(attention, ["top", "total"], "project overview.attention"); number(attention.total, "project overview.attention.total"); array(attention.top, "project overview.attention.top").forEach((item, index) => { attentionItem(item, `project overview.attention.top[${index}]`); });
  if (overview.currentEpisode !== undefined) { const item = record(overview.currentEpisode, "project overview.currentEpisode"); exactKeys(item, ["href", "id", "status", "updatedAt"], "project overview.currentEpisode"); for (const key of ["href", "id", "status", "updatedAt"] as const) string(item[key], `project overview.currentEpisode.${key}`); }
  if (overview.latestReceipt !== undefined) { const item = record(overview.latestReceipt, "project overview.latestReceipt"); exactKeys(item, ["disposition", "href", "id", "status", "updatedAt"], "project overview.latestReceipt"); for (const key of ["disposition", "href", "id", "status", "updatedAt"] as const) string(item[key], `project overview.latestReceipt.${key}`); }
  array(overview.recentChanges, "project overview.recentChanges").forEach((raw, index) => { const path = `project overview.recentChanges[${index}]`; const item = record(raw, path); exactKeys(item, ["at", "href", "id", "kind", "label", "status"], path); for (const key of ["at", "href", "id", "kind", "label", "status"] as const) string(item[key], `${path}.${key}`); });
  return overview as unknown as ProjectOverviewDto;
}

const BRIEF_FIELD_NAMES = ["allowedChanges", "currentStage", "currentTask", "evidenceBoundaries", "expectedDeltas", "explicitNonGoals", "fixedDecisions", "forbiddenChanges", "projectQuestion", "targetArtifacts"] as const;

function researchSource(value: unknown, path: string): void {
  const source = record(value, path); exactKeys(source, ["actor", "authority", "recordedAt"], path); string(source.authority, `${path}.authority`); string(source.recordedAt, `${path}.recordedAt`);
  const actor = record(source.actor, `${path}.actor`); const kind = string(actor.kind, `${path}.actor.kind`);
  if (kind === "user") { exactKeys(actor, ["actorId", "kind"], `${path}.actor`); string(actor.actorId, `${path}.actor.actorId`); }
  else if (kind === "system") { exactKeys(actor, ["component", "kind"], `${path}.actor`); string(actor.component, `${path}.actor.component`); }
  else if (kind === "import") { exactKeys(actor, ["kind", "sourceSystem"], `${path}.actor`); string(actor.sourceSystem, `${path}.actor.sourceSystem`); }
  else if (kind === "model") { allowedKeys(actor, ["kind", "model", "provider", "sessionId"], `${path}.actor`); for (const key of ["model", "provider", "sessionId"] as const) if (actor[key] !== undefined) string(actor[key], `${path}.actor.${key}`); }
  else fail(`${path}.actor.kind`);
}

function scopeTarget(value: unknown, path: string): void {
  const target = record(value, path); const kind = string(target.kind, `${path}.kind`);
  if (kind === "project_path") { exactKeys(target, ["kind", "relativePath"], path); string(target.relativePath, `${path}.relativePath`); return; }
  if (kind === "artifact") { exactKeys(target, ["artifactId", "kind"], path); string(target.artifactId, `${path}.artifactId`); return; }
  if (kind === "heading") { exactKeys(target, ["artifactId", "heading", "kind"], path); string(target.artifactId, `${path}.artifactId`); string(target.heading, `${path}.heading`); return; }
  if (kind === "block") { exactKeys(target, ["artifactId", "blockId", "kind"], path); string(target.artifactId, `${path}.artifactId`); string(target.blockId, `${path}.blockId`); return; }
  fail(`${path}.kind`);
}

function scopeRule(value: unknown, path: string): void {
  const rule = record(value, path); exactKeys(rule, ["operations", "target"], path); scopeTarget(rule.target, `${path}.target`); strings(rule.operations, `${path}.operations`);
}

function statementRule(value: unknown, path: string, evidenceBoundary = false): void {
  const rule = record(value, path); if (evidenceBoundary) { allowedKeys(rule, ["allowedSourceIds", "forbiddenInferenceKinds", "id", "scope", "statement"], path); for (const required of ["forbiddenInferenceKinds", "id", "scope", "statement"] as const) if (!(required in rule)) fail(`${path}.${required}`); } else exactKeys(rule, ["id", "scope", "statement"], path); string(rule.id, `${path}.id`); string(rule.statement, `${path}.statement`); scopeRule(rule.scope, `${path}.scope`); if (evidenceBoundary) { strings(rule.forbiddenInferenceKinds, `${path}.forbiddenInferenceKinds`); if (rule.allowedSourceIds !== undefined) strings(rule.allowedSourceIds, `${path}.allowedSourceIds`); }
}

function briefVersion(value: unknown, path: string): void {
  const version = record(value, path); allowedKeys(version, [...BRIEF_FIELD_NAMES, "createdAt", "id", "projectId", "source", "supersedes", "versionNumber"], path);
  for (const required of [...BRIEF_FIELD_NAMES, "createdAt", "id", "projectId", "source", "versionNumber"] as const) if (!(required in version)) fail(`${path}.${required}`);
  for (const key of ["createdAt", "currentStage", "currentTask", "id", "projectId", "projectQuestion"] as const) string(version[key], `${path}.${key}`); if (version.supersedes !== undefined) string(version.supersedes, `${path}.supersedes`); number(version.versionNumber, `${path}.versionNumber`); researchSource(version.source, `${path}.source`);
  strings(version.targetArtifacts, `${path}.targetArtifacts`); strings(version.explicitNonGoals, `${path}.explicitNonGoals`);
  array(version.fixedDecisions, `${path}.fixedDecisions`).forEach((item, index) => { statementRule(item, `${path}.fixedDecisions[${index}]`); });
  array(version.allowedChanges, `${path}.allowedChanges`).forEach((item, index) => { scopeRule(item, `${path}.allowedChanges[${index}]`); });
  array(version.forbiddenChanges, `${path}.forbiddenChanges`).forEach((item, index) => { scopeRule(item, `${path}.forbiddenChanges[${index}]`); });
  array(version.expectedDeltas, `${path}.expectedDeltas`).forEach((item, index) => { statementRule(item, `${path}.expectedDeltas[${index}]`); });
  array(version.evidenceBoundaries, `${path}.evidenceBoundaries`).forEach((item, index) => { statementRule(item, `${path}.evidenceBoundaries[${index}]`, true); });
}

export function decodeBriefWorkspace(value: unknown): BriefWorkspaceDto {
  const brief = record(value, "Brief workspace"); exactKeys(brief, ["active", "briefId", "candidateCount", "candidates", "candidatesTruncated", "entityVersion", "projectId", "schemaVersion", "versionCount", "versions", "versionsTruncated"], "Brief workspace"); requireSchema(brief, "Brief workspace");
  string(brief.projectId, "Brief workspace.projectId"); string(brief.briefId, "Brief workspace.briefId"); number(brief.entityVersion, "Brief workspace.entityVersion"); number(brief.versionCount, "Brief workspace.versionCount"); number(brief.candidateCount, "Brief workspace.candidateCount"); boolean(brief.versionsTruncated, "Brief workspace.versionsTruncated"); boolean(brief.candidatesTruncated, "Brief workspace.candidatesTruncated");
  briefVersion(brief.active, "Brief workspace.active"); array(brief.versions, "Brief workspace.versions").forEach((item, index) => { briefVersion(item, `Brief workspace.versions[${index}]`); });
  array(brief.candidates, "Brief workspace.candidates").forEach((raw, index) => {
    const path = `Brief workspace.candidates[${index}]`; const item = record(raw, path); allowedKeys(item, ["activatedVersionId", "baseVersionId", "changes", "confirmedAt", "createdAt", "diff", "diffFields", "id", "impact", "provenance", "reason", "status"], path);
    for (const required of ["baseVersionId", "changes", "createdAt", "diff", "diffFields", "id", "impact", "provenance", "reason", "status"] as const) if (!(required in item)) fail(`${path}.${required}`);
    provenance(item.provenance, `${path}.provenance`); const changes = record(item.changes, `${path}.changes`); if (Object.keys(changes).length === 0 || Object.keys(changes).some((key) => !BRIEF_FIELD_NAMES.includes(key as (typeof BRIEF_FIELD_NAMES)[number]))) fail(`${path}.changes`); safeTree(changes, `${path}.changes`); strings(item.diffFields, `${path}.diffFields`); for (const key of ["baseVersionId", "createdAt", "id", "reason", "status"] as const) string(item[key], `${path}.${key}`);
    array(item.diff, `${path}.diff`).forEach((rawDiff, diffIndex) => { const diffPath = `${path}.diff[${diffIndex}]`; const diff = record(rawDiff, diffPath); exactKeys(diff, ["after", "before", "change", "field"], diffPath); string(diff.field, `${diffPath}.field`); if (!BRIEF_FIELD_NAMES.includes(diff.field as (typeof BRIEF_FIELD_NAMES)[number])) fail(`${diffPath}.field`); if (!["added", "removed", "changed", "unchanged"].includes(String(diff.change))) fail(`${diffPath}.change`); safeTree(diff.before, `${diffPath}.before`); safeTree(diff.after, `${diffPath}.after`); });
    const impact = record(item.impact, `${path}.impact`); exactKeys(impact, ["activeEpisodeIds", "activeEpisodesTruncated", "currentTaskChanged", "evidenceBoundaryEffect", "expectedEntityVersion", "explicitNonGoalsRemoved", "fixedDecisionsChanged", "highImpactDirectionChange", "manifestImpact", "reviewImpact"], `${path}.impact`); boolean(impact.activeEpisodesTruncated, `${path}.impact.activeEpisodesTruncated`); boolean(impact.currentTaskChanged, `${path}.impact.currentTaskChanged`); boolean(impact.fixedDecisionsChanged, `${path}.impact.fixedDecisionsChanged`); boolean(impact.highImpactDirectionChange, `${path}.impact.highImpactDirectionChange`); strings(impact.activeEpisodeIds, `${path}.impact.activeEpisodeIds`); strings(impact.explicitNonGoalsRemoved, `${path}.impact.explicitNonGoalsRemoved`); for (const key of ["evidenceBoundaryEffect", "manifestImpact", "reviewImpact"] as const) string(impact[key], `${path}.impact.${key}`); number(impact.expectedEntityVersion, `${path}.impact.expectedEntityVersion`);
  });
  return brief as unknown as BriefWorkspaceDto;
}

export function decodeAttention(value: unknown): AttentionDto {
  const projection = record(value, "Attention"); exactKeys(projection, ["items", "projectId", "schemaVersion", "total", "truncated"], "Attention"); requireSchema(projection, "Attention"); string(projection.projectId, "Attention.projectId"); number(projection.total, "Attention.total"); boolean(projection.truncated, "Attention.truncated"); array(projection.items, "Attention.items").forEach((item, index) => { attentionItem(item, `Attention.items[${index}]`); }); return projection as unknown as AttentionDto;
}

export function decodeResearchObjectSearch(value: unknown): ResearchObjectSearchDto {
  const projection = record(value, "project search"); allowedKeys(projection, ["datasetVersion", "items", "nextCursor", "projectId", "query", "schemaVersion", "truncated"], "project search"); for (const required of ["datasetVersion", "items", "projectId", "query", "schemaVersion", "truncated"] as const) if (!(required in projection)) fail(`project search.${required}`); requireSchema(projection, "project search"); string(projection.projectId, "project search.projectId"); string(projection.datasetVersion, "project search.datasetVersion"); if (typeof projection.query !== "string") fail("project search.query"); if (projection.nextCursor !== undefined) string(projection.nextCursor, "project search.nextCursor"); boolean(projection.truncated, "project search.truncated");
  array(projection.items, "project search.items").forEach((raw, index) => { const path = `project search.items[${index}]`; const item = record(raw, path); exactKeys(item, ["detail", "href", "id", "kind", "projectId", "source", "status", "title"], path); for (const key of ["detail", "href", "id", "kind", "projectId", "source", "status", "title"] as const) string(item[key], `${path}.${key}`); if (!(item.href as string).startsWith("/project/")) fail(`${path}.href`); if (item.projectId !== projection.projectId) fail(`${path}.projectId`); });
  return projection as unknown as ResearchObjectSearchDto;
}

export function decodeResearchObjectDetail(value: unknown, kind: ResearchObjectKind): DecisionDetailDto | IssueDetailDto | EvidenceDetailDto | EpisodeDetailDto | ObjectReceiptDetailDto | AppealDetailDto | DeliberationRoomDetailDto {
  const item = record(value, `${kind} detail`); safeTree(item, `${kind} detail`);
  const allowed: Record<ResearchObjectKind, readonly string[]> = {
    decision: ["active", "availableActions", "createdAt", "effectiveBriefVersionId", "id", "kind", "lineage", "lineageTruncated", "provenance", "rationale", "referencedByCurrentBrief", "relatedBriefVersionIds", "relatedEpisodeIds", "relatedIssueIds", "relatedReceiptIds", "relationsTruncated", "reopenConditions", "scope", "statement", "status", "supersededByDecisionId", "supersedesDecisionId", "timeline", "updatedAt", "version"],
    issue: ["availableActions", "createdAt", "fingerprint", "firstSeenAt", "id", "issueKind", "kind", "lastSeenAt", "lineageRootRevisionId", "provenance", "rationaleConcepts", "recurrenceCount", "relatedBriefVersionIds", "relatedDecisionIds", "relatedEpisodeIds", "relatedEvidenceIds", "relatedReceiptIds", "relationsTruncated", "reopenHistory", "requiresUserAction", "resolution", "sourceArtifactId", "sourceRevisionContentHash", "sourceRevisionId", "status", "summary", "target", "timeline", "updatedAt", "version", "violatedCriterion"],
    evidence: ["artifactId", "capturedAt", "claimLinks", "confidence", "contentVersionHash", "evidenceKind", "id", "inferenceCapacity", "kind", "mechanismLinks", "provenance", "relatedBriefVersionIds", "relatedDecisionIds", "relatedEpisodeIds", "relatedIssueIds", "relationsTruncated", "revisionId", "safeLocator", "sensitivity", "state", "summary", "uncertainty", "userVerificationState", "version"],
    episode: ["argumentDeltas", "artifactId", "candidateRevisionId", "createdAt", "findingIds", "id", "kind", "lockedBrief", "lockedStart", "lockedStartHash", "outcome", "provenance", "relatedDecisionIds", "relatedIssueIds", "relatedReceiptIds", "relationsTruncated", "reviewRunIds", "status", "timeline", "updatedAt", "version", "waivers"],
    receipt: ["afterStateHash", "alternativeExplanations", "appealableFindings", "argumentDelta", "authority", "beforeStateHash", "contextFields", "correctionAppeals", "countsAsExternalEvidence", "createdAt", "disposition", "evidenceClass", "findings", "id", "kind", "ledgerOnlyReason", "minimalCorrection", "network", "providerStatus", "receiptHash", "relatedBriefVersionIds", "relatedDecisionIds", "relatedIssueIds", "reviewId", "rollback", "sourceEpisodeId", "status", "suggestionHash", "trace", "unknowns", "unproven", "updatedAt", "version"],
    appeal: ["attemptCount", "attempts", "availableActions", "canAutoResolve", "createdAt", "criterionId", "disagreement", "findingId", "id", "kind", "latestComparison", "lineage", "relatedReceiptHref", "resolutionCount", "resolutions", "reviewId", "source", "sourceReceiptId", "statements", "status", "timeline", "updatedAt", "userAuthorityOnly", "version"],
    deliberation_room: ["assessments", "availableActions", "canAutoResolve", "challenge", "challengeStatus", "createdAt", "differenceSummary", "differenceSummaryAvailable", "id", "kind", "manifests", "manualExternalOpinions", "manualOpinionCount", "participantStates", "participants", "providerCallCount", "providerCallLimit", "providerReadiness", "receiptHrefs", "resolutionCount", "resolutions", "retry", "retryStatus", "reveal", "source", "sourceHref", "status", "title", "trace", "updatedAt", "userAuthorityOnly", "version"],
  };
  allowedKeys(item, allowed[kind], `${kind} detail`);
  if (item.kind !== kind) fail(`${kind} detail.kind`); string(item.id, `${kind} detail.id`); number(item.version, `${kind} detail.version`);
  if (kind === "decision") {
    requiredKeys(item, ["active", "availableActions", "createdAt", "effectiveBriefVersionId", "lineage", "lineageTruncated", "provenance", "rationale", "referencedByCurrentBrief", "relatedBriefVersionIds", "relatedEpisodeIds", "relatedIssueIds", "relatedReceiptIds", "relationsTruncated", "reopenConditions", "scope", "statement", "status", "timeline", "updatedAt"], "decision detail");
    scope(item.scope, "decision detail.scope"); provenance(item.provenance, "decision detail.provenance"); for (const key of ["createdAt", "effectiveBriefVersionId", "rationale", "statement", "status", "updatedAt"] as const) string(item[key], `decision detail.${key}`); for (const key of ["relatedBriefVersionIds", "relatedEpisodeIds", "relatedIssueIds", "relatedReceiptIds", "reopenConditions"] as const) strings(item[key], `decision detail.${key}`); const decisionActions = strings(item.availableActions, "decision detail.availableActions"); if (decisionActions.some((action) => !["accept", "reject", "freeze", "supersede"].includes(action))) fail("decision detail.availableActions"); for (const key of ["active", "lineageTruncated", "referencedByCurrentBrief", "relationsTruncated"] as const) boolean(item[key], `decision detail.${key}`); if (item.supersedesDecisionId !== undefined) string(item.supersedesDecisionId, "decision detail.supersedesDecisionId"); if (item.supersededByDecisionId !== undefined) string(item.supersededByDecisionId, "decision detail.supersededByDecisionId"); safeTree(item.timeline, "decision detail.timeline"); array(item.lineage, "decision detail.lineage").forEach((raw, index) => { const path = `decision detail.lineage[${index}]`; const line = record(raw, path); exactKeys(line, ["id", "relation", "statement", "status", "version"], path); for (const key of ["id", "relation", "statement", "status"] as const) string(line[key], `${path}.${key}`); number(line.version, `${path}.version`); });
  } else if (kind === "issue") {
    requiredKeys(item, ["availableActions", "createdAt", "fingerprint", "firstSeenAt", "issueKind", "lastSeenAt", "lineageRootRevisionId", "provenance", "rationaleConcepts", "recurrenceCount", "relatedBriefVersionIds", "relatedDecisionIds", "relatedEpisodeIds", "relatedEvidenceIds", "relatedReceiptIds", "relationsTruncated", "reopenHistory", "requiresUserAction", "sourceArtifactId", "sourceRevisionContentHash", "sourceRevisionId", "status", "summary", "target", "timeline", "updatedAt", "violatedCriterion"], "issue detail");
    provenance(item.provenance, "issue detail.provenance"); for (const key of ["createdAt", "fingerprint", "firstSeenAt", "issueKind", "lastSeenAt", "lineageRootRevisionId", "sourceArtifactId", "sourceRevisionContentHash", "sourceRevisionId", "status", "summary", "updatedAt", "violatedCriterion"] as const) string(item[key], `issue detail.${key}`); for (const key of ["rationaleConcepts", "relatedBriefVersionIds", "relatedDecisionIds", "relatedEpisodeIds", "relatedEvidenceIds", "relatedReceiptIds"] as const) strings(item[key], `issue detail.${key}`); const issueActions = strings(item.availableActions, "issue detail.availableActions"); if (issueActions.some((action) => !["resolve", "waive", "dispute", "reopen"].includes(action))) fail("issue detail.availableActions"); number(item.recurrenceCount, "issue detail.recurrenceCount"); boolean(item.requiresUserAction, "issue detail.requiresUserAction"); boolean(item.relationsTruncated, "issue detail.relationsTruncated"); safeTree(item.target, "issue detail.target"); safeTree(item.timeline, "issue detail.timeline"); safeTree(item.reopenHistory, "issue detail.reopenHistory"); if (item.resolution !== undefined) safeTree(item.resolution, "issue detail.resolution");
  } else if (kind === "evidence") {
    requiredKeys(item, ["capturedAt", "claimLinks", "confidence", "evidenceKind", "inferenceCapacity", "mechanismLinks", "provenance", "relatedBriefVersionIds", "relatedDecisionIds", "relatedEpisodeIds", "relatedIssueIds", "relationsTruncated", "safeLocator", "sensitivity", "state", "summary", "uncertainty", "userVerificationState"], "evidence detail");
    provenance(item.provenance, "evidence detail.provenance"); for (const key of ["capturedAt", "confidence", "evidenceKind", "inferenceCapacity", "sensitivity", "state", "summary", "uncertainty", "userVerificationState"] as const) string(item[key], `evidence detail.${key}`); for (const key of ["relatedBriefVersionIds", "relatedDecisionIds", "relatedEpisodeIds", "relatedIssueIds"] as const) strings(item[key], `evidence detail.${key}`); if (item.artifactId !== undefined) string(item.artifactId, "evidence detail.artifactId"); if (item.revisionId !== undefined) string(item.revisionId, "evidence detail.revisionId"); if (item.contentVersionHash !== undefined) string(item.contentVersionHash, "evidence detail.contentVersionHash"); boolean(item.relationsTruncated, "evidence detail.relationsTruncated"); safeTree(item.safeLocator, "evidence detail.safeLocator"); safeTree(item.claimLinks, "evidence detail.claimLinks"); safeTree(item.mechanismLinks, "evidence detail.mechanismLinks");
  } else if (kind === "episode") {
    requiredKeys(item, ["argumentDeltas", "artifactId", "createdAt", "findingIds", "lockedStart", "lockedStartHash", "provenance", "relatedDecisionIds", "relatedIssueIds", "relatedReceiptIds", "relationsTruncated", "reviewRunIds", "status", "timeline", "updatedAt", "waivers"], "episode detail");
    provenance(item.provenance, "episode detail.provenance"); for (const key of ["artifactId", "createdAt", "lockedStartHash", "status", "updatedAt"] as const) string(item[key], `episode detail.${key}`); if (item.candidateRevisionId !== undefined) string(item.candidateRevisionId, "episode detail.candidateRevisionId"); for (const key of ["findingIds", "relatedDecisionIds", "relatedIssueIds", "relatedReceiptIds", "reviewRunIds"] as const) strings(item[key], `episode detail.${key}`); boolean(item.relationsTruncated, "episode detail.relationsTruncated"); safeTree(item.lockedStart, "episode detail.lockedStart"); safeTree(item.timeline, "episode detail.timeline"); safeTree(item.waivers, "episode detail.waivers"); safeTree(item.argumentDeltas, "episode detail.argumentDeltas"); if (item.outcome !== undefined) safeTree(item.outcome, "episode detail.outcome"); if (item.lockedBrief !== undefined) { const locked = record(item.lockedBrief, "episode detail.lockedBrief"); exactKeys(locked, ["stage", "task", "versionId"], "episode detail.lockedBrief"); for (const key of ["stage", "task", "versionId"] as const) string(locked[key], `episode detail.lockedBrief.${key}`); }
  } else if (kind === "receipt") {
    requiredKeys(item, ["afterStateHash", "alternativeExplanations", "appealableFindings", "argumentDelta", "authority", "beforeStateHash", "contextFields", "correctionAppeals", "countsAsExternalEvidence", "createdAt", "disposition", "evidenceClass", "findings", "minimalCorrection", "network", "providerStatus", "receiptHash", "relatedBriefVersionIds", "relatedDecisionIds", "relatedIssueIds", "reviewId", "rollback", "status", "suggestionHash", "trace", "unknowns", "unproven", "updatedAt"], "receipt detail");
    if (item.countsAsExternalEvidence !== false) fail("receipt detail.countsAsExternalEvidence"); for (const key of ["afterStateHash", "beforeStateHash", "createdAt", "evidenceClass", "minimalCorrection", "providerStatus", "receiptHash", "reviewId", "status", "suggestionHash", "updatedAt"] as const) string(item[key], `receipt detail.${key}`); if (item.ledgerOnlyReason !== undefined) string(item.ledgerOnlyReason, "receipt detail.ledgerOnlyReason"); if (item.sourceEpisodeId !== undefined) string(item.sourceEpisodeId, "receipt detail.sourceEpisodeId"); for (const key of ["alternativeExplanations", "relatedBriefVersionIds", "relatedDecisionIds", "relatedIssueIds", "unknowns", "unproven"] as const) strings(item[key], `receipt detail.${key}`); for (const key of ["appealableFindings", "argumentDelta", "authority", "contextFields", "correctionAppeals", "disposition", "findings", "network", "rollback", "trace"] as const) safeTree(item[key], `receipt detail.${key}`);
  } else if (kind === "appeal") {
    appealSummaryDecoder(item, "appeal detail", true);
    requiredKeys(item, ["attempts", "availableActions", "canAutoResolve", "lineage", "relatedReceiptHref", "resolutions", "source", "statements", "timeline", "userAuthorityOnly"], "appeal detail");
    if (item.userAuthorityOnly !== true || item.canAutoResolve !== false) fail("appeal detail.authority");
    string(item.relatedReceiptHref, "appeal detail.relatedReceiptHref");
    const actions = strings(item.availableActions, "appeal detail.availableActions");
    if (actions.some((action) => !["edit", "record", "record_only", "prepare_second_opinion", "confirm_send", "cancel", "resolve", "retry_with_new_manifest"].includes(action))) fail("appeal detail.availableActions");
    for (const key of ["source", "lineage", "statements", "attempts", "resolutions", "timeline"] as const) safeTree(item[key], `appeal detail.${key}`);
    if (item.latestComparison !== undefined) safeTree(item.latestComparison, "appeal detail.latestComparison");
  } else {
    deliberationSummaryDecoder(item, "deliberation room detail", true);
    requiredKeys(item, ["assessments", "availableActions", "canAutoResolve", "manualExternalOpinions", "participants", "receiptHrefs", "resolutions", "sourceHref", "trace", "userAuthorityOnly"], "deliberation room detail");
    if (item.userAuthorityOnly !== true || item.canAutoResolve !== false) fail("deliberation room detail.authority");
    string(item.sourceHref, "deliberation room detail.sourceHref"); strings(item.receiptHrefs, "deliberation room detail.receiptHrefs");
    const actions = strings(item.availableActions, "deliberation room detail.availableActions");
    if (actions.some((action) => !["prepare_manifests", "confirm_and_start", "cancel", "reveal_complete", "reveal_partial", "prepare_retry", "confirm_retry", "prepare_challenge", "finish_review", "import_manual_opinion", "resolve", "close"].includes(action))) fail("deliberation room detail.availableActions");
    const participants = array(item.participants, "deliberation room detail.participants"); if (participants.length !== 2) fail("deliberation room detail.participants");
    for (const key of ["participants", "assessments", "manualExternalOpinions", "resolutions", "trace"] as const) safeTree(item[key], `deliberation room detail.${key}`);
    if (item.manifests !== undefined) { const manifests = array(item.manifests, "deliberation room detail.manifests"); if (manifests.length !== 2) fail("deliberation room detail.manifests"); safeTree(manifests, "deliberation room detail.manifests"); }
    for (const key of ["reveal", "differenceSummary", "challenge", "retry"] as const) if (item[key] !== undefined) safeTree(item[key], `deliberation room detail.${key}`);
  }
  return item as unknown as DecisionDetailDto | IssueDetailDto | EvidenceDetailDto | EpisodeDetailDto | ObjectReceiptDetailDto | AppealDetailDto | DeliberationRoomDetailDto;
}

function decodeAppealManifest(value: unknown, path: string): AppealManifestDto {
  const manifest = record(value, path);
  exactKeys(manifest, ["canonicalHash", "costEstimate", "excludedFields", "includedFields", "includedObjects", "requestBodyBytes", "requestBodyHash", "requestHash", "schemaVersion", "stateBindingHash", "tokenEstimate"], path);
  requireSchema(manifest, path);
  for (const key of ["canonicalHash", "requestBodyHash", "requestHash", "stateBindingHash"] as const) string(manifest[key], `${path}.${key}`);
  number(manifest.requestBodyBytes, `${path}.requestBodyBytes`); strings(manifest.includedFields, `${path}.includedFields`); strings(manifest.excludedFields, `${path}.excludedFields`);
  array(manifest.includedObjects, `${path}.includedObjects`).forEach((raw, index) => { const objectPath = `${path}.includedObjects[${index}]`; const object = record(raw, objectPath); exactKeys(object, ["fields", "hash", "id", "kind", "version"], objectPath); if (!["brief", "decision", "issue", "evidence"].includes(String(object.kind))) fail(`${objectPath}.kind`); string(object.id, `${objectPath}.id`); string(object.hash, `${objectPath}.hash`); number(object.version, `${objectPath}.version`); const fields = record(object.fields, `${objectPath}.fields`); Object.entries(fields).forEach(([key, field]) => { string(key, `${objectPath}.fields.key`); string(field, `${objectPath}.fields.${key}`); }); });
  safeTree(manifest.tokenEstimate, `${path}.tokenEstimate`); safeTree(manifest.costEstimate, `${path}.costEstimate`);
  return manifest as unknown as AppealManifestDto;
}

export function decodePreparedAppealSecondOpinion(value: unknown): PreparedAppealSecondOpinionDto {
  const prepared = record(value, "prepared appeal second opinion");
  exactKeys(prepared, ["appeal", "confirmationNonce", "contextManifestVisible", "attemptId", "manifest", "providerPreview", "schemaVersion"], "prepared appeal second opinion");
  requireSchema(prepared, "prepared appeal second opinion");
  if (prepared.contextManifestVisible !== true) fail("prepared appeal second opinion.contextManifestVisible");
  const preview = record(prepared.providerPreview, "prepared appeal second opinion.providerPreview");
  exactKeys(preview, ["endpoint", "redirectPolicy", "requestBodyBytes", "responseLimitBytes", "retryCount"], "prepared appeal second opinion.providerPreview");
  string(preview.endpoint, "prepared appeal second opinion.providerPreview.endpoint"); number(preview.requestBodyBytes, "prepared appeal second opinion.providerPreview.requestBodyBytes"); number(preview.responseLimitBytes, "prepared appeal second opinion.providerPreview.responseLimitBytes");
  if (preview.retryCount !== 0 || preview.redirectPolicy !== "error") fail("prepared appeal second opinion.providerPreview.safety");
  return { schemaVersion: "1.0.0", contextManifestVisible: true, appeal: decodeResearchObjectDetail(prepared.appeal, "appeal") as AppealDetailDto, attemptId: string(prepared.attemptId, "prepared appeal second opinion.attemptId"), confirmationNonce: string(prepared.confirmationNonce, "prepared appeal second opinion.confirmationNonce"), manifest: decodeAppealManifest(prepared.manifest, "prepared appeal second opinion.manifest"), providerPreview: preview as unknown as PreparedAppealSecondOpinionDto["providerPreview"] };
}

function decodeDeliberationPreview(value: unknown, path: string): PreparedDeliberationRetryDto["providerPreview"] {
  const preview = record(value, path); exactKeys(preview, ["endpoint", "redirectPolicy", "requestBodyBytes", "responseLimitBytes", "retryCount"], path);
  string(preview.endpoint, `${path}.endpoint`); number(preview.requestBodyBytes, `${path}.requestBodyBytes`); number(preview.responseLimitBytes, `${path}.responseLimitBytes`);
  if (preview.retryCount !== 0 || preview.redirectPolicy !== "error") fail(`${path}.safety`);
  return preview as unknown as PreparedDeliberationRetryDto["providerPreview"];
}

export function decodePreparedDeliberation(value: unknown): PreparedDeliberationDto {
  const prepared = record(value, "prepared deliberation"); allowedKeys(prepared, ["contextManifestsVisible", "manifests", "providerPreviews", "room", "schemaVersion", "sharedContextOnly"], "prepared deliberation"); requiredKeys(prepared, ["contextManifestsVisible", "manifests", "providerPreviews", "room", "schemaVersion"], "prepared deliberation"); requireSchema(prepared, "prepared deliberation");
  if (prepared.contextManifestsVisible !== true) fail("prepared deliberation.contextManifestsVisible");
  if (prepared.sharedContextOnly !== undefined && prepared.sharedContextOnly !== true) fail("prepared deliberation.sharedContextOnly");
  const manifests = array(prepared.manifests, "prepared deliberation.manifests"); const previews = array(prepared.providerPreviews, "prepared deliberation.providerPreviews"); if (manifests.length !== 2 || previews.length !== 2) fail("prepared deliberation.pairs"); safeTree(manifests, "prepared deliberation.manifests");
  return { schemaVersion: "1.0.0", contextManifestsVisible: true, ...(prepared.sharedContextOnly === true ? { sharedContextOnly: true as const } : {}), room: decodeResearchObjectDetail(prepared.room, "deliberation_room") as DeliberationRoomDetailDto, manifests: manifests as unknown as PreparedDeliberationDto["manifests"], providerPreviews: previews.map((preview, index) => decodeDeliberationPreview(preview, `prepared deliberation.providerPreviews[${index}]`)) as unknown as PreparedDeliberationDto["providerPreviews"] };
}

export function decodePreparedDeliberationRetry(value: unknown): PreparedDeliberationRetryDto {
  const prepared = record(value, "prepared deliberation retry"); exactKeys(prepared, ["contextManifestVisible", "manifest", "providerPreview", "room", "schemaVersion"], "prepared deliberation retry"); requireSchema(prepared, "prepared deliberation retry");
  if (prepared.contextManifestVisible !== true) fail("prepared deliberation retry.contextManifestVisible"); safeTree(prepared.manifest, "prepared deliberation retry.manifest");
  return { schemaVersion: "1.0.0", contextManifestVisible: true, room: decodeResearchObjectDetail(prepared.room, "deliberation_room") as DeliberationRoomDetailDto, manifest: prepared.manifest as PreparedDeliberationRetryDto["manifest"], providerPreview: decodeDeliberationPreview(prepared.providerPreview, "prepared deliberation retry.providerPreview") };
}

export function decodeBriefActivation(value: unknown): { readonly schemaVersion: "1.0.0"; readonly workspace: BriefWorkspaceDto; readonly changedFields: readonly string[] } {
  const result = record(value, "Brief activation"); exactKeys(result, ["changedFields", "schemaVersion", "workspace"], "Brief activation"); requireSchema(result, "Brief activation");
  return { schemaVersion: "1.0.0", workspace: decodeBriefWorkspace(result.workspace), changedFields: strings(result.changedFields, "Brief activation.changedFields") };
}

export function decodeDecisionSupersede(value: unknown): { readonly schemaVersion: "1.0.0"; readonly superseded: DecisionDetailDto; readonly replacement: DecisionDetailDto } {
  const result = record(value, "Decision supersede"); exactKeys(result, ["replacement", "schemaVersion", "superseded"], "Decision supersede"); requireSchema(result, "Decision supersede");
  return { schemaVersion: "1.0.0", superseded: decodeResearchObjectDetail(result.superseded, "decision") as DecisionDetailDto, replacement: decodeResearchObjectDetail(result.replacement, "decision") as DecisionDetailDto };
}
