import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";
import {
  ScopeChecker,
  calculateReviewInputHash,
  diffMarkdownBlocks,
  parseProjectRelativePath,
  parseReviewContext,
  type ReviewContext,
  type ScopeCheckInput,
} from "../src/index.js";

const ids = new SequenceIdFactory(5000);
const projectId = ids.create("rprj_"); const episodeId = ids.create("repi_"); const artifactId = ids.create("rart_");
const baselineId = ids.create("rrev_"); const candidateId = ids.create("rrev_"); const briefId = ids.create("rbrf_"); const snapshotId = ids.create("rsnp_");

function context(): ReviewContext {
  const input = {
    project: { id: projectId, version: 1 }, episode: { id: episodeId, version: 2, artifactId, baselineRevisionId: baselineId, candidateRevisionId: candidateId },
    baselineRevision: { id: baselineId, artifactId, projectId, contentHash: "a".repeat(64) }, candidateRevision: { id: candidateId, artifactId, projectId, parentRevisionId: baselineId, contentHash: "b".repeat(64) },
    briefVersion: { id: briefId, versionNumber: 1 }, activeDecisions: [], relevantIssues: [], evidenceBoundaries: [], snapshot: { id: snapshotId, projectId, episodeId, hash: "c".repeat(64) },
    checkerSet: [{ id: "scope", version: "1.0.0", kind: "deterministic" as const }], environmentFingerprint: "d".repeat(64), buildFingerprint: "e".repeat(64),
  };
  const parsed = parseReviewContext({ ...input, inputHash: calculateReviewInputHash(input) });
  if (!parsed.ok) throw new Error(parsed.error.code); return parsed.value;
}

const baseline = `# Manuscript

## Introduction

The introduction is stable.

## Literature Review

Prior work supports the bounded claim.

## Data

| Group | N |
| --- | --- |
| A | 10 |
`;

function input(candidate: string, overrides: Partial<ScopeCheckInput> = {}): ScopeCheckInput {
  return {
    baselineDocuments: [{ artifactId, relativePath: "paper/manuscript.md", markdown: baseline }],
    candidateDocuments: [{ artifactId, relativePath: "paper/manuscript.md", markdown: candidate }],
    allowedChanges: [], forbiddenChanges: [], ...overrides,
  };
}

describe("deterministic scope and path checking", () => {
  it("flags an Introduction edit when only Literature Review is allowed", async () => {
    const candidate = baseline.replace("The introduction is stable.", "The introduction now makes a new claim.");
    const result = await new ScopeChecker(input(candidate, { allowedChanges: [{ target: { kind: "heading", artifactId, heading: "Literature Review" }, operations: ["rewrite"] }] })).run(context());
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe("scope_violation");
    expect(result.findings[0]?.target).toMatchObject({ relativePath: "paper/manuscript.md" });
  });

  it("distinguishes data replacement from a theory rewrite", async () => {
    const candidate = baseline.replace("The introduction is stable.", "A different theory now explains the relationship.");
    const result = await new ScopeChecker(input(candidate, { allowedChanges: [{ target: { kind: "artifact", artifactId }, operations: ["data_replace"] }] })).run(context());
    expect(result.findings[0]).toMatchObject({ kind: "scope_violation" });
    expect(result.observations?.some((item) => item.code === "rewrite")).toBe(true);
  });

  it("accepts the same edit after an explicit user-confirmed scope proposal", async () => {
    const candidate = baseline.replace("The introduction is stable.", "The introduction now makes a new claim.");
    const result = await new ScopeChecker(input(candidate, {
      allowedChanges: [{ target: { kind: "heading", artifactId, heading: "Literature Review" }, operations: ["rewrite"] }],
      confirmedScopeProposal: {
        source: { actor: { kind: "user", actorId: "lead" }, authority: "user_confirmed", recordedAt: "2026-08-19T10:00:00.000Z" },
        allowedChanges: [{ target: { kind: "heading", artifactId, heading: "Introduction" }, operations: ["rewrite"] }],
      },
    })).run(context());
    expect(result.findings).toEqual([]);
  });

  it("returns scope_unknown for a heading rename instead of alleging a violation", async () => {
    const candidate = baseline.replace("## Literature Review", "## Related Work");
    const result = await new ScopeChecker(input(candidate)).run(context());
    expect(result.findings).toEqual([expect.objectContaining({ kind: "scope_unknown" })]);
  });

  it("classifies an unchanged block move separately from rewrite", () => {
    const before = "# A\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const after = "# A\n\nSecond paragraph.\n\nFirst paragraph.\n";
    const result = diffMarkdownBlocks(before, after);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changes.some((change) => change.operation === "move")).toBe(true);
      expect(result.value.changes.some((change) => change.operation === "rewrite")).toBe(false);
    }
  });

  it("reports an allowed/forbidden collision rather than choosing silently", async () => {
    const candidate = baseline.replace("The introduction is stable.", "The introduction now makes a new claim.");
    const rule = { target: { kind: "heading" as const, artifactId, heading: "Introduction" }, operations: ["rewrite" as const] };
    const result = await new ScopeChecker(input(candidate, { allowedChanges: [rule], forbiddenChanges: [rule] })).run(context());
    expect(result.findings[0]).toMatchObject({ kind: "scope_rule_conflict" });
  });

  it("does not flag a large rewrite when the artifact operation is authorized", async () => {
    const candidate = baseline.replace("The introduction is stable.", "Changed introduction.").replace("Prior work supports the bounded claim.", "Changed review.").replace("| A | 10 |", "| B | 90 |");
    const result = await new ScopeChecker(input(candidate, { allowedChanges: [{ target: { kind: "artifact", artifactId }, operations: ["rewrite", "data_replace"] }] })).run(context());
    expect(result.findings).toEqual([]);
  });

  it.each(["../secret.md", "C:\\secret.md", "\\\\server\\share\\x.md", "/etc/passwd", "%2e%2e/secret.md", "%252e%252e/secret.md"])("rejects unsafe project path %s", (path) => {
    expect(parseProjectRelativePath(path)).toMatchObject({ ok: false });
  });
});
