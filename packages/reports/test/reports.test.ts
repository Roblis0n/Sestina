import { describe, expect, it } from "vitest";
import { SequenceIdFactory, stableResearchHash } from "@sestina/research";
import {
  calculateReviewInputHash,
  createFinding,
  deriveCoverage,
  deriveReviewOutcome,
  parseReviewContext,
  parseReviewRun,
  type Finding,
  type ObligationCoverage,
  type ReviewContext,
  type ReviewObligation,
  type ReviewOutcome,
  type ReviewRun,
} from "@sestina/review";
import {
  exportCapsule,
  importCapsuleResponse,
  parseReviewJson,
  redactAbsolutePaths,
  renderReviewJson,
  renderReviewMarkdown,
  truncateUtf8,
  type CapsuleExportInput,
  type ReviewReportInput,
} from "../src/index.js";

const ids = new SequenceIdFactory(8000);
const projectId = ids.create("rprj_"); const episodeId = ids.create("repi_"); const artifactId = ids.create("rart_");
const baselineId = ids.create("rrev_"); const candidateId = ids.create("rrev_"); const briefId = ids.create("rbrf_"); const snapshotId = ids.create("rsnp_");

function context(): ReviewContext {
  const input = {
    project: { id: projectId, version: 1 }, episode: { id: episodeId, version: 2, artifactId, baselineRevisionId: baselineId, candidateRevisionId: candidateId },
    baselineRevision: { id: baselineId, artifactId, projectId, contentHash: "a".repeat(64) }, candidateRevision: { id: candidateId, artifactId, projectId, parentRevisionId: baselineId, contentHash: "b".repeat(64) },
    briefVersion: { id: briefId, versionNumber: 1 }, activeDecisions: [], relevantIssues: [], evidenceBoundaries: [], snapshot: { id: snapshotId, projectId, episodeId, hash: "c".repeat(64) },
    checkerSet: [{ id: "scope", version: "1", kind: "deterministic" as const }, { id: "semantic", version: "1", kind: "semantic" as const }],
    environmentFingerprint: "d".repeat(64), buildFingerprint: "e".repeat(64),
  };
  const parsed = parseReviewContext({ ...input, inputHash: calculateReviewInputHash(input) }); if (!parsed.ok) throw new Error(parsed.error.code); return parsed.value;
}

function finding(seed: number, kind: string, severity: "info" | "warning" | "error" | "critical", presentation: "foreground" | "audit_only" | "suppressed", checker = "scope"): Finding {
  const ctx = context(); const result = createFinding({
    id: new SequenceIdFactory(seed).create("rfnd_"), kind, severity, target: { kind: "artifact", artifactId }, baselineEvidence: [],
    candidateEvidence: checker === "semantic" && kind !== "checker_error" ? [{ artifactId, revisionId: candidateId, startLine: 1, endLine: 1, excerptHash: "f".repeat(64) }] : [],
    briefVersionId: briefId, decisionIds: [], issueIds: [], checker: { id: checker, version: "1", kind: checker === "semantic" ? "semantic" : "deterministic" },
    confidence: { source: checker === "semantic" ? "model" : "rule", value: kind === "checker_error" ? 0 : 1 },
    rationale: `Reason for ${kind}`, minimumRecovery: `Recover ${kind}`, needsUserDecision: false, presentation,
    provenance: { authority: checker === "semantic" ? "model_proposed" : "system_derived", inputHash: ctx.inputHash },
  }); if (!result.ok) throw new Error(result.error.code); return result.value;
}

function fixture(): { report: ReviewReportInput; run: ReviewRun; outcome: ReviewOutcome; obligations: readonly ReviewObligation[]; coverage: readonly ObligationCoverage[] } {
  const ctx = context();
  const findings = [
    finding(8100, "critical_scope", "critical", "foreground"), finding(8200, "evidence_gap", "error", "foreground"),
    finding(8300, "wording", "warning", "foreground"), finding(8400, "minor", "info", "foreground"),
    finding(8500, "repeated_audit", "warning", "suppressed"), finding(8600, "checker_error", "error", "audit_only", "semantic"),
  ];
  const parsed = parseReviewRun({ id: new SequenceIdFactory(8700).create("rrun_"), projectId, episodeId, snapshotId, context: ctx, inputHash: ctx.inputHash, status: "completed_with_checker_errors", findings, checkerErrors: [{ checker: { id: "semantic", version: "1", kind: "semantic" }, code: "checker_error" }], version: 3, startedAt: "2026-08-19T13:00:00.000Z", completedAt: "2026-08-19T13:00:01.000Z" });
  if (!parsed.ok) throw new Error(parsed.error.code);
  const obligations: readonly ReviewObligation[] = [{ id: "scope-obligation", dimension: "scope", criterion: "Stay in scope", source: { kind: "brief", id: briefId }, required: true }];
  const coverage = deriveCoverage(obligations, [{ obligationId: "scope-obligation", status: "checked_violated", findingIds: [findings[0]?.id ?? ""] }], findings);
  const outcome = deriveReviewOutcome({ obligations, coverage, findings, expectedCheckerIds: ["scope", "semantic"], completedCheckerIds: ["scope"], failedCheckerIds: ["semantic"], userDisposition: "pending" });
  return { run: parsed.value, outcome, obligations, coverage, report: { title: "Bounded manuscript review", taskSummary: "Revise the manuscript without changing its question", run: parsed.value, outcome, obligations, coverage, preservedContent: ["Research question retained"], userActions: ["Review the scope violation"] } };
}

describe("local Review reports", () => {
  it("renders stable Markdown with only three foreground Findings and all nine sections", () => {
    const { report } = fixture(); const first = renderReviewMarkdown(report); const second = renderReviewMarkdown(report);
    expect(first).toBe(second);
    expect(stableResearchHash(first)).toEqual({ ok: true, value: "64ceaadcf70d9c1c4f451b00e3a44cc8ae99c8561e60a74d6fd84518c6381b5e" });
    for (const heading of ["Task and locked versions", "Honest overall state", "Foreground findings", "Preserved content", "Minimum recovery path", "Suppressed repeats", "Unchecked or uncertain", "User actions", "Provenance"]) expect(first).toContain(`## ${heading}`);
    expect(first).toContain("3 of 4 foreground findings shown");
    expect(first).not.toContain("Reason for minor");
    expect(first).toContain("Deterministic placeholder ordering");
  });

  it("escapes malicious Markdown, links, tables, fences, headings and front matter", () => {
    const { report } = fixture();
    const markdown = renderReviewMarkdown({ ...report, title: "---\n# forged\n[x](https://evil.example) | col\n```" });
    expect(markdown).not.toContain("\n# forged");
    expect(markdown).not.toContain("](https://evil.example)");
    expect(markdown).not.toContain("\n```");
    expect(markdown).toContain("\\# forged");
  });

  it("renders byte-stable versioned JSON and rejects unknown versions", () => {
    const { report } = fixture(); const first = renderReviewJson(report); const second = renderReviewJson(report);
    expect(first).toBe(second);
    const parsed = parseReviewJson(first); expect(parsed).toMatchObject({ ok: true, value: { schemaVersion: "1.0.0" } });
    expect(parseReviewJson(first.replace('"1.0.0"', '"9.0.0"'))).toMatchObject({ ok: false, error: { code: "unsupported_report_version" } });
    expect(first).toContain("checker_error"); expect(first).toContain("suppressed"); expect(first).toContain("checked_violated");
  });
});

function capsuleInput(): CapsuleExportInput {
  const ctx = context();
  return {
    projectId, brief: { id: briefId, summary: "Brief summary from C:\\Users\\name\\private.md", expectedDeltas: ["Improve argument"] },
    activeDecisions: [{ id: new SequenceIdFactory(8800).create("rdec_"), statement: "Keep the question", status: "frozen" }],
    relevantIssues: [{ id: new SequenceIdFactory(8900).create("riss_"), summary: "Evidence gap", status: "open" }],
    baseline: { artifactId, revisionId: baselineId, relativePath: "paper/manuscript.md", summary: "Baseline 摘要", content: "PRIVATE BASELINE /home/name/secret", privacy: "private_a", contentPermission: "summary_only" },
    candidate: { artifactId, revisionId: candidateId, relativePath: "paper/manuscript.md", summary: "Candidate 摘要", content: "PRIVATE CANDIDATE", privacy: "private_b", contentPermission: "summary_only" },
    evidenceBoundaries: ["No causal inference"], expectedDeltas: ["Improve argument"], snapshotId, snapshotHash: ctx.snapshot.hash, reviewInputHash: ctx.inputHash,
    invalidationConditions: ["Brief or artifact changes"], buildFingerprint: ctx.buildFingerprint, checkerVersions: ctx.checkerSet,
  };
}

describe("portable Review Capsule", () => {
  it("defaults to summaries, relative paths and deterministic bounded output", () => {
    const first = exportCapsule(capsuleInput(), { maxBytes: 4096, maxItemsPerSection: 1 }); const second = exportCapsule(capsuleInput(), { maxBytes: 4096, maxItemsPerSection: 1 });
    expect(first).toEqual(second); expect(first.ok).toBe(true); if (!first.ok) return;
    expect(new TextEncoder().encode(first.value.json).byteLength).toBeLessThanOrEqual(4096);
    expect(first.value.json).not.toContain("PRIVATE BASELINE"); expect(first.value.json).not.toContain("PRIVATE CANDIDATE");
    expect(first.value.json).not.toContain("C:\\\\Users"); expect(first.value.capsule.hashMeaning).toBe("content_integrity_only_not_signature_or_proof");
    expect(first.value.capsule.capsuleHash).toBe("629baa468d9cb7a1a831786089b0d91e7853e2cc79ca87837ee7097ee8cc5154");
  });

  it("uses a public fixed overflow order and records every omission", () => {
    const input = capsuleInput();
    const exported = exportCapsule({
      ...input,
      baseline: { ...input.baseline, contentPermission: "full_text", content: "BASELINE SECRET ".repeat(300) },
      candidate: { ...input.candidate, contentPermission: "full_text", content: "CANDIDATE SECRET ".repeat(300) },
      relevantIssues: [
        ...input.relevantIssues,
        { id: new SequenceIdFactory(8950).create("riss_"), summary: "Secondary issue ".repeat(80), status: "open" },
      ],
    }, { includePermittedFullText: true, maxBytes: 2_048, maxItemsPerSection: 1 });
    expect(exported.ok).toBe(true); if (!exported.ok) return;
    expect(new TextEncoder().encode(exported.value.json).byteLength).toBeLessThanOrEqual(2_048);
    expect(exported.value.json).not.toContain("BASELINE SECRET");
    expect(exported.value.capsule).toMatchObject({
      baseline: { projection: "summary_only" }, candidate: { projection: "summary_only" },
      omissions: { issues: 2, baselineContent: 1, candidateContent: 1 },
      truncationPolicy: { withinSection: "ascending_id_or_text" },
    });
  });

  it("redacts Windows, Unix, UNC and home paths and truncates UTF-8 without replacement", () => {
    expect(redactAbsolutePaths("C:\\Users\\a\\x \\server\\share\\y /home/a/z ~/q")).not.toMatch(/C:\\|\\server|\/home\/|~\//);
    const value = truncateUtf8("研究🙂研究🙂", 9);
    expect(new TextEncoder().encode(value.text).byteLength).toBeLessThanOrEqual(9);
    expect(value.text).not.toContain("�"); expect(value.omittedBytes).toBeGreaterThan(0);
  });

  it("round-trips only a candidate response and rejects stale bindings", () => {
    const exported = exportCapsule(capsuleInput()); expect(exported.ok).toBe(true); if (!exported.ok) return;
    const response = JSON.stringify({ schemaVersion: "1.0.0", projectId, snapshotHash: exported.value.capsule.snapshot.hash, reviewInputHash: exported.value.capsule.reviewInputHash, briefVersionId: briefId, artifactRevisionId: candidateId, response: { summary: "Model candidate C:\\Users\\a\\secret", findings: ["Potential issue"] } });
    const expected = { projectId, snapshotHash: exported.value.capsule.snapshot.hash, reviewInputHash: exported.value.capsule.reviewInputHash, briefVersionId: briefId, artifactRevisionId: candidateId };
    const imported = importCapsuleResponse(response, expected);
    expect(imported).toMatchObject({ ok: true, value: { status: "candidate", authority: "model_proposed", canMutateAuthority: false } });
    if (imported.ok) expect(JSON.stringify(imported.value)).not.toContain("C:\\\\Users");
    expect(importCapsuleResponse(response, { ...expected, snapshotHash: "0".repeat(64) })).toMatchObject({ ok: false, error: { code: "stale_capsule_response" } });
    expect(importCapsuleResponse(response, { ...expected, briefVersionId: new SequenceIdFactory(9000).create("rbrf_") })).toMatchObject({ ok: false, error: { code: "stale_capsule_response" } });
  });
});
