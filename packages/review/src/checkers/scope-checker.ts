import { parseResearchSource, parseScopeRule, type ResearchSource, type ScopeOperation, type ScopeRule } from "@sestina/research";
import type { CheckerResult, ResearchChecker } from "../checker.js";
import { createFinding, type Finding } from "../finding.js";
import type { ReviewContext } from "../review-context.js";
import { cloneReviewValue } from "../review-result.js";
import { findingIdFromFingerprint } from "./fingerprint.js";
import { diffMarkdownBlocks, type BlockChange } from "../diff/block-diff.js";
import { parseProjectRelativePath } from "../diff/path-policy.js";

export interface ScopeDocument { readonly artifactId: string; readonly relativePath: string; readonly markdown: string; }
export interface ConfirmedScopeProposal { readonly source: ResearchSource; readonly allowedChanges: readonly ScopeRule[]; }
export interface ScopeCheckInput {
  readonly baselineDocuments: readonly ScopeDocument[]; readonly candidateDocuments: readonly ScopeDocument[];
  readonly allowedChanges: readonly ScopeRule[]; readonly forbiddenChanges: readonly ScopeRule[];
  readonly confirmedScopeProposal?: ConfirmedScopeProposal;
}

type LocatedChange = BlockChange & { readonly artifactId: string; readonly relativePath: string };

function ruleMatches(rule: ScopeRule, change: LocatedChange, operation: ScopeOperation): boolean {
  if (!rule.operations.includes(operation)) return false;
  switch (rule.target.kind) {
    case "artifact": return rule.target.artifactId === change.artifactId;
    case "heading": return rule.target.artifactId === change.artifactId && rule.target.heading === change.heading;
    case "block": return rule.target.artifactId === change.artifactId && rule.target.blockId === change.blockId;
    case "project_path": return change.relativePath === rule.target.relativePath || change.relativePath.startsWith(`${rule.target.relativePath}/`);
  }
}

export class ScopeChecker implements ResearchChecker {
  readonly id = "scope"; readonly version = "1.0.0"; readonly kind = "deterministic" as const;
  readonly #input: ScopeCheckInput; readonly #valid: boolean;
  constructor(input: ScopeCheckInput) {
    let valid = Array.isArray(input.baselineDocuments) && Array.isArray(input.candidateDocuments) && Array.isArray(input.allowedChanges) && Array.isArray(input.forbiddenChanges);
    const parseRules = (rules: readonly ScopeRule[]) => rules.map((rule) => { const parsed = parseScopeRule(rule); if (!parsed.ok) valid = false; return parsed.ok ? parsed.value : rule; });
    const allowedChanges = parseRules(input.allowedChanges); const forbiddenChanges = parseRules(input.forbiddenChanges);
    let confirmedScopeProposal: ConfirmedScopeProposal | undefined;
    if (input.confirmedScopeProposal) {
      const source = parseResearchSource(input.confirmedScopeProposal.source);
      if (!source.ok || source.value.actor.kind !== "user" || source.value.authority !== "user_confirmed") valid = false;
      else confirmedScopeProposal = { source: source.value, allowedChanges: parseRules(input.confirmedScopeProposal.allowedChanges) };
    }
    const documents = (values: readonly ScopeDocument[]) => values.map((document) => { const path = parseProjectRelativePath(document.relativePath); if (!path.ok || typeof document.markdown !== "string") valid = false; return { ...document, relativePath: path.ok ? path.value : "invalid" }; });
    this.#input = cloneReviewValue({ baselineDocuments: documents(input.baselineDocuments), candidateDocuments: documents(input.candidateDocuments), allowedChanges, forbiddenChanges, ...(confirmedScopeProposal ? { confirmedScopeProposal } : {}) });
    this.#valid = valid;
  }
  supports(): boolean { return true; }

  run(context: ReviewContext): Promise<CheckerResult> {
    const finding = (kind: "scope_unknown" | "scope_violation" | "scope_rule_conflict", rationale: string, change?: LocatedChange): Finding => {
      const before = change?.baseline; const after = change?.candidate;
      const created = createFinding({
        id: findingIdFromFingerprint({ checker: this.id, inputHash: context.inputHash, kind, path: change?.relativePath, blockId: change?.blockId, operation: change?.operation }),
        kind, severity: kind === "scope_unknown" ? "warning" : "error",
        target: change ? { kind: "block", artifactId: change.artifactId, relativePath: change.relativePath, blockId: change.blockId } : { kind: "project" },
        baselineEvidence: before ? [{ artifactId: change.artifactId, revisionId: context.baselineRevision.id, startLine: before.startLine, endLine: before.endLine, excerptHash: before.contentHash }] : [],
        candidateEvidence: after ? [{ artifactId: change.artifactId, revisionId: context.candidateRevision.id, startLine: after.startLine, endLine: after.endLine, excerptHash: after.contentHash }] : [],
        briefVersionId: context.briefVersion.id, decisionIds: context.activeDecisions.map((item) => item.id), issueIds: context.relevantIssues.map((item) => item.id),
        checker: { id: this.id, version: this.version, kind: this.kind }, confidence: { source: "rule", value: kind === "scope_unknown" ? 0 : 1 }, rationale,
        minimumRecovery: kind === "scope_unknown" ? "Rebind the changed heading or path, then re-run scope review" : "Restore the specific block or obtain a user-confirmed scope proposal",
        needsUserDecision: kind !== "scope_unknown", presentation: "foreground", provenance: { authority: "system_derived", inputHash: context.inputHash },
      });
      if (!created.ok) throw new Error("Scope Finding construction failed"); return created.value;
    };
    if (!this.#valid) return Promise.resolve({ findings: [finding("scope_unknown", "A project path, rule, or user confirmation could not be validated")], observations: [{ code: "scope_unknown", message: "Scope inputs could not be located safely" }] });
    const before = new Map(this.#input.baselineDocuments.map((document) => [`${document.artifactId}\u0000${document.relativePath}`, document]));
    const after = new Map(this.#input.candidateDocuments.map((document) => [`${document.artifactId}\u0000${document.relativePath}`, document]));
    const changes: LocatedChange[] = []; const unknowns: Finding[] = [];
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const baseline = before.get(key); const candidate = after.get(key); const document = candidate ?? baseline; if (!document) continue;
      if (!baseline || !candidate) {
        const markdown = candidate?.markdown ?? baseline?.markdown ?? ""; const diff = diffMarkdownBlocks(baseline ? markdown : "", candidate ? markdown : "");
        if (diff.ok) changes.push(...diff.value.changes.map((change) => ({ ...change, artifactId: document.artifactId, relativePath: document.relativePath })));
        continue;
      }
      const diff = diffMarkdownBlocks(baseline.markdown, candidate.markdown);
      if (!diff.ok || diff.value.scopeUnknown) { unknowns.push(finding("scope_unknown", "A heading changed identity, so the edited block cannot be located reliably")); continue; }
      changes.push(...diff.value.changes.map((change) => ({ ...change, artifactId: document.artifactId, relativePath: document.relativePath })));
    }
    const confirmed = this.#input.confirmedScopeProposal?.allowedChanges ?? [];
    const allowed = [...this.#input.allowedChanges, ...confirmed]; const findings: Finding[] = [...unknowns];
    const observations = changes.map((change) => ({ code: change.operation, message: `${change.operation} at ${change.relativePath}${change.heading ? `#${change.heading}` : ""}` }));
    for (const change of changes) {
      if (change.operation === "move") continue;
      const operation = change.operation as ScopeOperation;
      const allow = allowed.some((rule) => ruleMatches(rule, change, operation));
      const forbid = this.#input.forbiddenChanges.some((rule) => ruleMatches(rule, change, operation));
      if (allow && forbid) findings.push(finding("scope_rule_conflict", `The ${operation} change matches both an allowed and forbidden rule`, change));
      else if (forbid || !allow) findings.push(finding("scope_violation", `The ${operation} change is outside the confirmed allowed scope`, change));
    }
    return Promise.resolve(cloneReviewValue({ findings, observations }));
  }
}
