import {
  cloneFrozen,
  isNonBlankString,
  isRecord,
  parseSafeRelativePath,
} from "../domain-validation.js";
import { researchError } from "../errors.js";
import { canonicalStringify } from "../identity/canonical-json.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type ScopeOperation =
  | "add"
  | "delete"
  | "rewrite"
  | "data_replace"
  | "citation_add";
export type ScopeTarget =
  | { readonly kind: "artifact"; readonly artifactId: string }
  | { readonly kind: "heading"; readonly artifactId: string; readonly heading: string }
  | { readonly kind: "block"; readonly artifactId: string; readonly blockId: string }
  | { readonly kind: "project_path"; readonly relativePath: string };
export interface ScopeRule {
  readonly target: ScopeTarget;
  readonly operations: readonly ScopeOperation[];
}

const OPERATIONS: readonly ScopeOperation[] = ["add", "delete", "rewrite", "data_replace", "citation_add"];

export function parseScopeRule(input: unknown): ResearchResult<ScopeRule> {
  if (!isRecord(input) || !isRecord(input.target) || !Array.isArray(input.operations)) return err(researchError("invalid_scope_rule"));
  const operations: ScopeOperation[] = [];
  for (const value of input.operations) {
    if (typeof value !== "string" || !OPERATIONS.includes(value as ScopeOperation) || operations.includes(value as ScopeOperation)) return err(researchError("invalid_scope_rule"));
    operations.push(value as ScopeOperation);
  }
  if (operations.length === 0) return err(researchError("invalid_scope_rule"));
  operations.sort();
  const raw = input.target;
  let target: ScopeTarget;
  if (raw.kind === "project_path") {
    const path = parseSafeRelativePath(raw.relativePath);
    if (!path.ok) return path;
    target = { kind: "project_path", relativePath: path.value };
  } else {
    const artifactId = parseResearchIdFor(raw.artifactId, "rart_");
    if (!artifactId.ok) return artifactId;
    if (raw.kind === "artifact") target = { kind: "artifact", artifactId: artifactId.value.id };
    else if (raw.kind === "heading" && isNonBlankString(raw.heading)) target = { kind: "heading", artifactId: artifactId.value.id, heading: raw.heading.trim().replace(/\s+/g, " ") };
    else if (raw.kind === "block" && isNonBlankString(raw.blockId)) target = { kind: "block", artifactId: artifactId.value.id, blockId: raw.blockId.trim() };
    else return err(researchError("invalid_scope_rule"));
  }
  return ok(cloneFrozen({ target, operations }));
}

export function normalizedScopeTargetKey(scope: ScopeRule): ResearchResult<string> {
  const parsed = parseScopeRule(scope);
  if (!parsed.ok) return parsed;
  return canonicalStringify(parsed.value.target);
}

export function findScopeRuleConflict(allowed: readonly ScopeRule[], forbidden: readonly ScopeRule[]): ResearchResult<boolean> {
  const allowedRules: { key: string; operations: readonly ScopeOperation[] }[] = [];
  for (const value of allowed) {
    const rule = parseScopeRule(value); if (!rule.ok) return rule;
    const key = normalizedScopeTargetKey(rule.value); if (!key.ok) return key;
    allowedRules.push({ key: key.value, operations: rule.value.operations });
  }
  for (const value of forbidden) {
    const rule = parseScopeRule(value); if (!rule.ok) return rule;
    const key = normalizedScopeTargetKey(rule.value); if (!key.ok) return key;
    if (allowedRules.some((candidate) => candidate.key === key.value && candidate.operations.some((operation) => rule.value.operations.includes(operation)))) return ok(true);
  }
  return ok(false);
}
