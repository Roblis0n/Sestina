import { SequenceIdFactory } from "@sestina/research";
import {
  buildMinimalCorrections,
  createFinding,
  projectFindings,
  type Finding,
  type MinimalCorrectionContext,
  type MinimalCorrectionProjection,
} from "@sestina/review";
import { describe, expect, it } from "vitest";

import { renderMinimalCorrectionMarkdown } from "../src/index.js";

const ids = new SequenceIdFactory(35_500);
const projectId = ids.create("rprj_");
const briefVersionId = ids.create("rbrf_");
const artifactId = ids.create("rart_");
const revisionId = ids.create("rrev_");
const decisionId = ids.create("rdec_");

function finding(): Finding {
  const parsed = createFinding({
    id: ids.create("rfnd_"),
    kind: "mechanism_evidence_gap",
    severity: "error",
    target: { kind: "artifact", artifactId },
    baselineEvidence: [],
    candidateEvidence: [{
      artifactId,
      revisionId,
      startLine: 4,
      endLine: 4,
      excerptHash: "a".repeat(64),
    }],
    briefVersionId,
    decisionIds: [decisionId],
    issueIds: [],
    checker: {
      id: "claim-evidence-mechanism",
      version: "1.0.0",
      kind: "deterministic",
    },
    confidence: { source: "rule", value: 1 },
    rationale: "The mechanism relation is absent.",
    minimumRecovery:
      "Add the missing evidence-to-mechanism relation at claim [A].",
    needsUserDecision: false,
    presentation: "foreground",
    provenance: {
      authority: "model_proposed",
      inputHash: "b".repeat(64),
    },
  });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

function context(source: Finding): MinimalCorrectionContext {
  return {
    projectId,
    briefVersionId,
    currentResearchTask:
      "Explain <mechanism> without replacing the registered question.",
    targetArtifactIds: [artifactId],
    targetRelativePaths: [],
    protectedDecisionIds: [decisionId],
    preservedParts: [{
      statement: "Keep the supported effect | estimate.",
      evidenceFindingIds: [source.id],
    }],
  };
}

function readyProjection(): MinimalCorrectionProjection {
  const source = finding();
  const result = buildMinimalCorrections(
    projectFindings([source]),
    context(source),
  );
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("minimal correction markdown", () => {
  it("renders the five parts in a short stable order with provenance", () => {
    const projection = readyProjection();
    const markdown = renderMinimalCorrectionMarkdown(projection);

    expect(markdown.indexOf("## Preserve")).toBeLessThan(
      markdown.indexOf("## Stop"),
    );
    expect(markdown.indexOf("## Stop")).toBeLessThan(
      markdown.indexOf("## Minimum missing relation or action"),
    );
    expect(markdown.indexOf("## Minimum missing relation or action"))
      .toBeLessThan(markdown.indexOf("## Must not change"));
    expect(markdown.indexOf("## Must not change")).toBeLessThan(
      markdown.indexOf("## Recovery verification"),
    );
    expect(markdown).toContain("Suggestion ownership: model\\_proposed");
    expect(markdown).toContain("Keep the supported effect \\| estimate\\.");
    expect(markdown).not.toContain("<mechanism>");
    expect(Buffer.byteLength(markdown, "utf8")).toBeLessThan(5_000);
    expect(renderMinimalCorrectionMarkdown(projection)).toBe(markdown);
  });

  it("renders an empty normal control without inventing a correction", () => {
    const projection = buildMinimalCorrections(projectFindings([]), {
      ...context(finding()),
      preservedParts: [],
    });
    if (!projection.ok) throw new Error(projection.error.code);

    const markdown = renderMinimalCorrectionMarkdown(projection.value);

    expect(markdown).toContain("Status: not\\_needed");
    expect(markdown).toContain("No foreground Finding requires correction\\.");
    expect(markdown).not.toContain("## Minimum missing relation or action");
  });

  it("renders a typed uncorrectable state without guessing", () => {
    const source = finding();
    const projection = buildMinimalCorrections(
      projectFindings([source]),
      { ...context(source), maxCorrections: 0 },
    );
    if (!projection.ok) throw new Error(projection.error.code);

    const markdown = renderMinimalCorrectionMarkdown(projection.value);

    expect(markdown).toContain("Status: uncorrectable");
    expect(markdown).toContain("intervention\\_budget\\_exhausted");
    expect(markdown).not.toContain("## Preserve");
  });

  it("rejects malformed projections instead of rendering guessed fields", () => {
    expect(() => renderMinimalCorrectionMarkdown({} as never)).toThrow(
      "Invalid minimal correction",
    );
  });
});
