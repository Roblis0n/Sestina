import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";
import {
  ARGUMENT_LEAP_RUBRIC,
  REPEATED_AUDIT_RUBRIC,
  createStableTextSpan,
  prepareResearchRoomSemanticJudge,
  submitResearchRoomSemanticJudge,
  type ResearchRoomSemanticJudgeResponse,
} from "../src/index.js";

const ids = new SequenceIdFactory(7_400);
const PROJECT_ID = ids.create("rprj_");
const REVIEW_ID = ids.create("rrvw_");
const BRIEF_ID = ids.create("rbrf_");
const BRIEF_CONSTRAINT_ID = ids.create("rbrf_");
const ARTIFACT_ID = ids.create("rart_");
const REVISION_ID = ids.create("rrev_");
const DECISION_ID = ids.create("rdec_");
const ISSUE_ID = ids.create("riss_");
const EPISODE_ID = ids.create("repi_");
const RECEIPT_ID = ids.create("rrcp_");

function prepared() {
  const result = prepareResearchRoomSemanticJudge({
    reviewId: REVIEW_ID,
    projectId: PROJECT_ID,
    provider: {
      id: "local-openai",
      family: "openai_compatible",
      model: "judge-model",
      baseUrlOrigin: "http://127.0.0.1:11434",
      locality: "local",
      configGeneration: 3,
    },
    stateBindingHash: "a".repeat(64),
    brief: {
      id: BRIEF_ID,
      versionNumber: 2,
      projectQuestion: "How does selection affect the observed association?",
      currentStage: "revision",
      currentTask: "Add one bounded mechanism statement.",
      fixedDecisions: [{ id: BRIEF_CONSTRAINT_ID, statement: "Do not infer causality." }],
      expectedDeltas: [{ id: BRIEF_ID, statement: "Add a concrete selection mechanism." }],
      evidenceBoundaries: ["Observational evidence cannot identify a causal effect."],
      explicitNonGoals: ["Do not start another repository audit."],
    },
    decisions: [{ id: DECISION_ID, status: "frozen", statement: "Do not infer causality.", rationale: "No random assignment.", version: 2 }],
    issues: [{ id: ISSUE_ID, kind: "evidence_boundary", summary: "Causal wording was removed.", status: "resolved", version: 4 }],
    receiptSummary: [{ id: RECEIPT_ID, disposition: "rejected", status: "committed", createdAt: "2026-08-23T09:00:00.000Z" }],
    currentEpisode: { id: EPISODE_ID, status: "active", version: 1, artifactId: ARTIFACT_ID, baselineRevisionId: REVISION_ID },
    suggestionDocument: {
      projectId: PROJECT_ID,
      artifactId: ARTIFACT_ID,
      revisionId: REVISION_ID,
      text: "Keep the observational boundary and add a selection mechanism linking exposure to inclusion.",
    },
    evidenceClass: "synthetic_fixture",
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function response(
  verdicts: Readonly<Record<string, "positive" | "negative" | "unknown">> = {},
): ResearchRoomSemanticJudgeResponse {
  const request = prepared();
  const document = request.context.suggestionDocument;
  const evidence = createStableTextSpan(document, 0, document.normalizedText.length);
  if (!evidence.ok) throw new Error(evidence.error.code);
  return {
    schemaVersion: "1.0.0",
    protocolVersion: request.protocol.version,
    protocolHash: request.protocol.hash,
    promptVersion: request.prompt.version,
    promptHash: request.prompt.hash,
    rubricVersion: request.rubric.version,
    rubricHash: request.rubric.hash,
    reviewId: request.reviewId,
    projectId: request.projectId,
    stateBindingHash: request.stateBindingHash,
    requestHash: request.requestHash,
    provider: request.provider,
    assessments: request.criteria.map((criterion) => {
      const verdict = verdicts[criterion.id]
        ?? (criterion.id === "argument-delta" ? "positive" : "negative");
      return {
        criterionId: criterion.id,
        verdict,
        evidenceSpans: verdict === "unknown" ? [] : [evidence.value],
        referencedDecisionIds: criterion.id === "decision-integrity" ? [DECISION_ID] : [],
        referencedIssueIds: criterion.id === "repeated-audit" ? [ISSUE_ID] : [],
        publicRationale: verdict === "positive"
          ? `The supplied evidence supports the positive meaning for ${criterion.id}.`
          : verdict === "negative"
            ? `The supplied evidence matches a hard negative for ${criterion.id}.`
            : `The supplied context is insufficient for ${criterion.id}.`,
        minimalCorrection: verdict === "positive" ? criterion.minimalRecoveryFormat.action : "No correction is proposed.",
        uncertainty: verdict === "unknown" ? "The missing relation cannot be inferred." : "No material uncertainty in the supplied span.",
        missingContext: verdict === "unknown" ? ["A directly comparable baseline statement is missing."] : [],
      };
    }),
  };
}

describe("Research Room Semantic Judge contract", () => {
  it("prepares one hash-bound request from the canonical rubrics without private or authority-bearing fields", () => {
    const request = prepared();
    expect(Object.isFrozen(request)).toBe(true);
    expect(request.criteria.map((criterion) => criterion.id)).toEqual([
      "focus-substitution",
      "repeated-audit",
      "audit-hijacking",
      "semantic-scope",
      "decision-integrity",
      "argument-leap",
      "evidence-boundary",
      "shallow-abstraction",
      "argument-delta",
    ]);
    const repeatedAudit = request.criteria.find((criterion) => criterion.id === "repeated-audit");
    const argumentLeap = request.criteria.find((criterion) => criterion.id === "argument-leap");
    expect(repeatedAudit?.positiveMeaning).toBe("repeated_audit");
    expect(repeatedAudit?.hardNegatives.some((item) => item.includes("new evidence"))).toBe(true);
    expect(argumentLeap?.positiveMeaning).toBe("argument_leap");
    expect(argumentLeap?.forbiddenHeuristics.some((item) => item.includes("correlation"))).toBe(true);
    expect(request.constraints).toMatchObject({ authority: "assessment_only", canMutateAuthority: false, candidateTextIsUntrusted: true });
    expect(request.excludedFields).toEqual(expect.arrayContaining([
      "project_paths", "unselected_files", "other_projects", "chat_history", "api_keys", "language_preference", "device_environment", "hidden_chain_of_thought",
    ]));
    expect(request.requestHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("accepts exactly one assessment per criterion and derives reasonable_increment only in the Kernel", () => {
    const request = prepared();
    const result = submitResearchRoomSemanticJudge(request, response());
    expect(result).toMatchObject({
      ok: true,
      value: {
        findings: [],
        argumentDelta: { status: "substantive" },
        reasonableIncrement: {
          status: "supported",
          authority: "system_derived",
          canMutateAuthority: false,
          blockingCriteria: [],
        },
        derivation: "system_derived_from_validated_assessments",
      },
    });
    expect(JSON.stringify(response())).not.toContain("reasonable_increment");
  });

  it("derives bounded model-proposed Findings from positive conflict assessments without granting authority", () => {
    const request = prepared();
    const result = submitResearchRoomSemanticJudge(request, response({
      "focus-substitution": "positive",
      "argument-leap": "positive",
    }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.findings.map((finding) => finding.kind)).toEqual(["focus_substitution", "argument_leap"]);
    expect(result.value.findings.every((finding) => finding.provenance.authority === "model_proposed")).toBe(true);
    expect(result.value.reasonableIncrement).toMatchObject({ status: "not_supported", authority: "system_derived", canMutateAuthority: false });
  });

  it("keeps unknown as a valid semantic result and distinct from provider failure", () => {
    const request = prepared();
    const result = submitResearchRoomSemanticJudge(request, response({ "evidence-boundary": "unknown" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assessments.find((item) => item.criterionId === "evidence-boundary")?.verdict).toBe("unknown");
    expect(result.value.reasonableIncrement).toMatchObject({ status: "unknown", blockingCriteria: ["evidence-boundary"] });
  });

  it.each([
    ["missing criterion", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, assessments: value.assessments.slice(1) })],
    ["duplicate criterion", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, assessments: [...value.assessments, value.assessments[0]] })],
    ["extra power field", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, disposition: "accepted" })],
    ["authority injection", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, authority: "user_confirmed" })],
    ["request mismatch", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, requestHash: "0".repeat(64) })],
    ["provider generation mismatch", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, provider: { ...value.provider, configGeneration: value.provider.configGeneration + 1 } })],
    ["forged decision id", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, assessments: value.assessments.map((item, index) => index === 0 ? { ...item, referencedDecisionIds: [ids.create("rdec_")] } : item) })],
    ["bad span hash", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, assessments: value.assessments.map((item, index) => index === 0 ? { ...item, evidenceSpans: item.evidenceSpans.map((span) => ({ ...span, quoteHash: "0".repeat(64) })) } : item) })],
    ["model metadata injection", (value: ResearchRoomSemanticJudgeResponse) => ({ ...value, provider: { ...value.provider, command: "close_issue" } })],
  ])("rejects %s atomically", (_name, mutate) => {
    const request = prepared();
    const before = structuredClone(request);
    expect(submitResearchRoomSemanticJudge(request, mutate(response()))).toMatchObject({ ok: false });
    expect(request).toEqual(before);
  });

  it("rejects Markdown-wrapped JSON and oversized public fields", () => {
    const request = prepared();
    expect(submitResearchRoomSemanticJudge(request, `\`\`\`json\n${JSON.stringify(response())}\n\`\`\``)).toMatchObject({ ok: false, error: { code: "invalid_json" } });
    const tooLarge = response();
    expect(submitResearchRoomSemanticJudge(request, {
      ...tooLarge,
      assessments: tooLarge.assessments.map((item, index) => index === 0 ? { ...item, publicRationale: "x".repeat(request.limits.maxPublicRationaleChars + 1) } : item),
    })).toMatchObject({ ok: false, error: { code: "limit_exceeded" } });
  });
});

describe("new formal semantic rubrics", () => {
  it("keeps repeated audit distinct from an explicit audit, necessary regression, and audit hijacking", () => {
    expect(REPEATED_AUDIT_RUBRIC.criterion.id).toBe("repeated-audit");
    expect(REPEATED_AUDIT_RUBRIC.hardNegatives).toEqual(expect.arrayContaining([
      expect.stringContaining("new evidence"),
      expect.stringContaining("necessary regression"),
      expect.stringContaining("explicitly requests an audit"),
    ]));
    expect(REPEATED_AUDIT_RUBRIC.criterion.id).not.toBe("audit-hijacking");
  });

  it("defines argument leap through a missing warrant and protects hypotheses and bounded association claims", () => {
    expect(ARGUMENT_LEAP_RUBRIC.criterion.id).toBe("argument-leap");
    expect(ARGUMENT_LEAP_RUBRIC.requiredQuestions).toEqual(expect.arrayContaining([
      expect.stringContaining("premise"),
      expect.stringContaining("warrant"),
      expect.stringContaining("conclusion"),
    ]));
    expect(ARGUMENT_LEAP_RUBRIC.hardNegatives).toEqual(expect.arrayContaining([
      expect.stringContaining("hypothesis"),
      expect.stringContaining("association"),
    ]));
  });
});
