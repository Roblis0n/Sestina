import type {
  AnalyzedReviewDto,
  AppLanguage,
  AssessmentDto,
  ContextManifestDto,
  PreparedReviewDto,
  ProjectOpenResultDto,
  ProviderStatusDto,
  ResearchRoomReceiptDto,
  ResearchRoomStateDto,
  SelectedDirectoryDto,
  SelectedDirectoryPreviewDto,
  StatusDto,
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
