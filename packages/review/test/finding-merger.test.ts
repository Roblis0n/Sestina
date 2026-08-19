import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";
import {
  createFinding,
  mergeFindings,
  projectFindings,
  rankFindings,
  selectProjectedFindings,
  type Finding,
  type FindingPresentation,
  type FindingSeverity,
} from "../src/index.js";

const ids = new SequenceIdFactory(34_000);
const artifactId = ids.create("rart_");
const revisionId = ids.create("rrev_");
const briefVersionId = ids.create("rbrf_");

interface FindingOverrides {
  readonly kind?: string;
  readonly severity?: FindingSeverity;
  readonly presentation?: FindingPresentation;
  readonly checkerId?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly rationale?: string;
  readonly recovery?: string;
  readonly confidence?: number;
}

function finding(seed: number, overrides: FindingOverrides = {}): Finding {
  const parsed = createFinding({
    id: new SequenceIdFactory(seed).create("rfnd_"),
    kind: overrides.kind ?? "evidence_gap",
    severity: overrides.severity ?? "warning",
    target: { kind: "artifact", artifactId },
    baselineEvidence: [],
    candidateEvidence: [{
      artifactId,
      revisionId,
      startLine: overrides.startLine ?? 10,
      endLine: overrides.endLine ?? overrides.startLine ?? 10,
      excerptHash: seed.toString(16).padStart(64, "0"),
    }],
    briefVersionId,
    decisionIds: [],
    issueIds: [],
    checker: { id: overrides.checkerId ?? "semantic-a", version: "1.0.0", kind: "semantic" },
    confidence: { source: "model", value: overrides.confidence ?? 0.5 },
    rationale: overrides.rationale ?? `Finding ${seed}`,
    minimumRecovery: overrides.recovery ?? "Repair the cited claim and continue the requested revision.",
    needsUserDecision: false,
    presentation: overrides.presentation ?? "foreground",
    provenance: { authority: "model_proposed", inputHash: "a".repeat(64) },
  });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

describe("RI-34 finding merger and intervention budget", () => {
  it("deduplicates multiple checkers that report the same root cause", () => {
    const first = finding(34_100, { kind: "focus_substitution", checkerId: "focus-a", severity: "error" });
    const second = finding(34_200, { kind: "target_substitution", checkerId: "focus-b", severity: "critical" });
    const merged = mergeFindings([first, second]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ rawFindingIds: [first.id, second.id], priority: 1 });
    expect(merged[0]?.finding.severity).toBe("critical");
  });

  it("merges the same span despite different wording", () => {
    const first = finding(34_300, { rationale: "The causal claim exceeds the source." });
    const second = finding(34_400, { rationale: "Evidence cannot support this causal conclusion.", checkerId: "semantic-b" });
    expect(mergeFindings([second, first])).toHaveLength(1);
  });

  it("uses criterion or the same minimum recovery in addition to a common root and location", () => {
    const first = finding(34_410, { kind: "focus_substitution", recovery: "Restore the requested question." });
    const second = finding(34_420, { kind: "target_substitution", recovery: "Continue with a different action." });
    expect(mergeFindings([first, second])).toHaveLength(2);
    const aligned = finding(34_430, { kind: "target_substitution", recovery: "Restore the requested question." });
    expect(mergeFindings([first, aligned])).toHaveLength(1);
  });

  it("keeps adjacent findings with different root causes separate", () => {
    const evidence = finding(34_500, { kind: "evidence_gap", startLine: 10, endLine: 10 });
    const scope = finding(34_600, { kind: "scope_violation", startLine: 11, endLine: 11 });
    expect(mergeFindings([evidence, scope])).toHaveLength(2);
  });

  it("does not let many low-value findings drown out target replacement", () => {
    const low = Array.from({ length: 12 }, (_, index) => finding(34_700 + index, {
      kind: `appendix_audit_${index}`,
      severity: "critical",
      startLine: 30 + index,
      confidence: 1,
    }));
    const target = finding(34_800, { kind: "user_authority_violation", severity: "warning", confidence: 0.01 });
    expect(rankFindings(mergeFindings([...low, target]))[0]?.finding.id).toBe(target.id);
  });

  it("does not charge suppressed repeats against the foreground budget", () => {
    const suppressed = finding(34_900, { presentation: "suppressed", severity: "critical" });
    const visible = finding(35_000, { kind: "scope_violation" });
    const projection = projectFindings([suppressed, visible], { unnecessaryFindingIds: [suppressed.id, "not-a-finding"] });
    expect(projection.foreground.map((item) => item.finding.id)).toEqual([visible.id]);
    expect(projection.suppressed.map((item) => item.findingId)).toEqual([suppressed.id]);
    expect(projection.metrics.foregroundFindingCount).toBe(1);
    expect(projection.metrics.unnecessaryFindingCount).toBe(1);
  });

  it("keeps a clean run empty and explains that no positive was fabricated", () => {
    const projection = projectFindings([], { preservedParts: [] });
    expect(projection.foreground).toEqual([]);
    expect(projection.preserved).toEqual({
      evidenceSupported: false,
      items: [],
      explanation: "No evidence-supported preserved part was identified.",
    });
  });

  it("shows at most three foreground interventions by default without padding", () => {
    const findings = Array.from({ length: 8 }, (_, index) => finding(35_100 + index, {
      kind: `evidence_gap_${index}`,
      startLine: 50 + index,
      recovery: `Repair claim ${index}.`,
    }));
    const projection = projectFindings(findings);
    expect(projection.foreground).toHaveLength(3);
    expect(projection.omissions.mergedOutsideForeground).toBe(5);
  });

  it("returns the complete raw list for all-findings without changing the projection", () => {
    const suppressed = finding(35_200, { presentation: "suppressed" });
    const findings = [suppressed, ...Array.from({ length: 5 }, (_, index) => finding(35_300 + index, { kind: `scope_violation_${index}`, startLine: 70 + index }))];
    const projection = projectFindings(findings);
    const before = JSON.stringify(projection);
    expect(selectProjectedFindings(projection, false)).toHaveLength(3);
    expect(selectProjectedFindings(projection, true)).toHaveLength(6);
    expect(JSON.stringify(projection)).toBe(before);
  });

  it("reconstructs byte-identical output from the same persisted findings", () => {
    const raw = [finding(35_400, { kind: "scope_violation" }), finding(35_500, { kind: "evidence_gap", startLine: 90 })];
    const first = projectFindings(raw, { preservedParts: ["The supplied question remains unchanged."] });
    const restarted = projectFindings(structuredClone(raw), { preservedParts: ["The supplied question remains unchanged."] });
    expect(JSON.stringify(restarted)).toBe(JSON.stringify(first));
  });
});
