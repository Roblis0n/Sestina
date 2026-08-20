import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";

import {
  buildMinimalCorrections,
  createFinding,
  parseMinimalCorrectionProjection,
  projectFindings,
  type Finding,
  type FindingEvidenceSpan,
  type FindingSeverity,
  type MinimalCorrectionContext,
} from "../src/index.js";

const ids = new SequenceIdFactory(35_000);
const PROJECT_ID = ids.create("rprj_");
const BRIEF_VERSION_ID = ids.create("rbrf_");
const ARTIFACT_ID = ids.create("rart_");
const SECOND_ARTIFACT_ID = ids.create("rart_");
const DECISION_ID = ids.create("rdec_");
const REVISION_ID = ids.create("rrev_");
const FIRST_FINDING_ID = new SequenceIdFactory(35_100).create("rfnd_");

interface FindingOverrides {
  readonly kind?: string;
  readonly severity?: FindingSeverity;
  readonly target?: Finding["target"];
  readonly baselineEvidence?: readonly FindingEvidenceSpan[];
  readonly candidateEvidence?: readonly FindingEvidenceSpan[];
  readonly confidence?: number;
  readonly recovery?: string;
  readonly presentation?: Finding["presentation"];
  readonly provenance?: Finding["provenance"];
}

function finding(seed: number, overrides: FindingOverrides = {}): Finding {
  const parsed = createFinding({
    id: new SequenceIdFactory(seed).create("rfnd_"),
    kind: overrides.kind ?? "argument_gap",
    severity: overrides.severity ?? "error",
    target: overrides.target ?? { kind: "artifact", artifactId: ARTIFACT_ID },
    baselineEvidence: overrides.baselineEvidence ?? [],
    candidateEvidence: overrides.candidateEvidence ?? [
      {
        artifactId:
          overrides.target?.artifactId ?? ARTIFACT_ID,
        revisionId: REVISION_ID,
        startLine: 10,
        endLine: 10,
        excerptHash: seed.toString(16).padStart(64, "0"),
      },
    ],
    briefVersionId: BRIEF_VERSION_ID,
    decisionIds: [DECISION_ID],
    issueIds: [],
    checker: {
      id: "claim-evidence-mechanism",
      version: "1.0.0",
      kind: "deterministic",
    },
    confidence: {
      source: "rule",
      value: overrides.confidence ?? 0.94,
    },
    rationale:
      "A causal conclusion is missing its evidence-to-mechanism relation.",
    minimumRecovery: overrides.recovery
      ?? "Add one sentence that connects the cited evidence to the stated mechanism.",
    needsUserDecision: false,
    presentation: overrides.presentation ?? "foreground",
    provenance: overrides.provenance ?? {
      authority: "system_derived",
      inputHash: "a".repeat(64),
    },
  });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

function context(
  overrides: Partial<MinimalCorrectionContext> = {},
): MinimalCorrectionContext {
  return {
    projectId: PROJECT_ID,
    briefVersionId: BRIEF_VERSION_ID,
    currentResearchTask:
      "Explain how the registered evidence supports the stated mechanism.",
    targetArtifactIds: [ARTIFACT_ID],
    targetRelativePaths: [],
    protectedDecisionIds: [DECISION_ID],
    preservedParts: [
      {
        statement:
          "Keep the evidence-supported description of the observed effect.",
        evidenceFindingIds: [FIRST_FINDING_ID],
      },
    ],
    maxCorrections: 3,
    ...overrides,
  };
}

describe("minimal correction", () => {
  it("turns a merged finding into a structured five-part recovery path", () => {
    const result = buildMinimalCorrections(
      projectFindings([finding(35_100)]),
      context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("ready");
    expect(result.value.corrections).toHaveLength(1);
    expect(result.value.corrections[0]).toMatchObject({
      status: "proposed",
      suggestionOwnership: "system_derived",
      preserve: [
        "Keep the evidence-supported description of the observed effect.",
      ],
      minimumMissingRelationOrAction:
        "Add one sentence that connects the cited evidence to the stated mechanism.",
      mustNotChange: {
        briefVersionId: BRIEF_VERSION_ID,
        currentResearchTask:
          "Explain how the registered evidence supports the stated mechanism.",
        protectedDecisionIds: [DECISION_ID],
      },
    });
    expect(result.value.corrections[0]?.stop).toHaveLength(1);
    expect(
      result.value.corrections[0]?.recoveryVerification,
    ).toHaveLength(1);
    expect(result.value.corrections[0]?.id).toMatch(
      /^mcor_[a-f0-9]{64}$/u,
    );
  });

  it("is deterministic for identical inputs", () => {
    const projection = projectFindings([
      finding(35_100),
    ]);

    expect(buildMinimalCorrections(projection, context())).toEqual(
      buildMinimalCorrections(projection, context()),
    );
  });

  it("does not repeat an action for overlapping findings", () => {
    const first = finding(35_100);
    const second = finding(35_200, {
      confidence: 0.9,
      provenance: { ...first.provenance, inputHash: "b".repeat(64) },
    });
    const result = buildMinimalCorrections(
      projectFindings([first, second]),
      context({
        preservedParts: [
          {
            statement:
              "Keep the evidence-supported description of the observed effect.",
            evidenceFindingIds: [first.id, second.id],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.corrections).toHaveLength(1);
    expect(result.value.corrections[0]?.sources.rawFindingIds).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("preserves evidence, checker, severity, decisions, and model ownership", () => {
    const source = finding(35_100, {
      provenance: {
        authority: "model_proposed",
        inputHash: "c".repeat(64),
      },
    });
    const result = buildMinimalCorrections(
      projectFindings([source]),
      context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.corrections[0]).toMatchObject({
      status: "proposed",
      suggestionOwnership: "model_proposed",
      sources: {
        severity: source.severity,
        checker: source.checker,
        baselineEvidence: source.baselineEvidence,
        candidateEvidence: source.candidateEvidence,
        decisionIds: source.decisionIds,
        provenance: [source.provenance],
      },
    });
  });

  it("returns not_needed when no foreground finding needs intervention", () => {
    expect(
      buildMinimalCorrections(projectFindings([]), context()),
    ).toMatchObject({
      ok: true,
      value: {
        status: "not_needed",
        reason: "no_foreground_findings",
        corrections: [],
      },
    });
  });

  it("returns uncorrectable for a target outside the locked brief", () => {
    expect(
      buildMinimalCorrections(
        projectFindings([finding(35_100)]),
        context({ targetArtifactIds: [] }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        status: "uncorrectable",
        reason: "target_outside_locked_brief",
        corrections: [],
      },
    });
  });

  it("rejects full rewrites and generic quality-expansion goals", () => {
    expect(
      buildMinimalCorrections(
        projectFindings([
          finding(35_100, {
            recovery:
              "Rewrite the entire manuscript and comprehensively improve quality.",
          }),
        ]),
        context(),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        status: "uncorrectable",
        reason: "unsafe_recovery_action",
        corrections: [],
      },
    });
  });

  it("returns uncorrectable when the intervention budget is exhausted", () => {
    expect(
      buildMinimalCorrections(
        projectFindings([finding(35_100)]),
        context({ maxCorrections: 0 }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        status: "uncorrectable",
        reason: "intervention_budget_exhausted",
        corrections: [],
      },
    });
  });

  it("fails explicitly for invalid input or missing locked context", () => {
    expect(buildMinimalCorrections({}, context())).toMatchObject({
      ok: false,
      error: { code: "invalid_minimal_correction" },
    });
    expect(
      buildMinimalCorrections(
        projectFindings([finding(35_100)]),
        {},
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_minimal_correction" },
    });
  });

  it("rejects a correction whose retained source Finding was forged", () => {
    const built = buildMinimalCorrections(
      projectFindings([finding(35_100)]),
      context(),
    );
    if (!built.ok) throw new Error(built.error.code);
    const forged = structuredClone(built.value) as unknown as {
      corrections: { sources: { rawFindings: { kind: string }[] } }[];
    };
    const first = forged.corrections.at(0)?.sources.rawFindings.at(0);
    if (first === undefined) throw new Error("missing test correction source");
    first.kind = "";

    expect(parseMinimalCorrectionProjection(forged)).toMatchObject({
      ok: false,
      error: { code: "invalid_minimal_correction" },
    });
  });

  it("integrates with the RI-34 merger ordering and dry budget", () => {
    const major = finding(35_100, { kind: "mechanism_evidence_gap" });
    const minor = finding(35_200, {
      kind: "expected_delta",
      severity: "warning",
      target: {
        kind: "artifact",
        artifactId: SECOND_ARTIFACT_ID,
      },
      recovery:
        "Add the one registered contrast required by the brief.",
      provenance: { ...major.provenance, inputHash: "d".repeat(64) },
    });
    const result = buildMinimalCorrections(
      projectFindings([minor, major]),
      context({
        targetArtifactIds: [
          ARTIFACT_ID,
          SECOND_ARTIFACT_ID,
        ],
        preservedParts: [],
        maxCorrections: 1,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.corrections).toHaveLength(1);
    expect(result.value.corrections[0]?.sources.mergedFindingId).toBe(
      major.id,
    );
    expect(result.value.omittedForegroundFindingIds).toEqual([minor.id]);
  });
});
