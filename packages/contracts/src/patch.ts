import {
  canActAsDirectUser,
  ContractPatchProposalSchema,
  generateId,
  SestinaError,
  SestinaErrorCode,
  TaskContractSchema,
  type ActorProvenance,
  type BoundaryOwner,
  type ContractFieldPath,
  type ContractPatchOperation,
  type ContractPatchProposal,
  type ContractSourceTier,
  type Deliverable,
  type MaterialAmbiguity,
  type SourceRef,
  type SourceSpan,
  type TaskContract,
} from "@sestina/schema";
import type { ContractSemanticExtractor } from "./extractor-port.js";
import { assertExpectedVersion, nextContractVersion } from "./versioning.js";

// ── Proposal input ──

export interface PatchProposalInput {
  contract: TaskContract;
  instruction: string;
  actor: ActorProvenance;
  sourceRefs?: readonly SourceRef[];
  /** Defaults to generateId(). */
  proposalId?: string;
  /** REQUIRED — never derived from the wall clock. */
  createdAt: string;
  /** Optional semantic fallback for instructions with no explicit directives. */
  extractor?: ContractSemanticExtractor;
  /** Passed to the extractor context; defaults to createdAt. */
  now?: string;
}

// ── Deterministic instruction parser ──
//
// The parser recognizes ONLY explicit directives on whitelisted paths:
//   预算/最大工具调用/最大 Provider 调用/最大裁决成本 → set_field on budgets.*
//   标题改为/设为 → set_field title
//   优先级改为 X (critical|high|normal|low) → set_field objective.priority
//   authority/evidencePolicy fields, only when named explicitly
//   新增/删除交付物、边界、停止条件、假设、范围(内/外) → matching ops
// Anything unrecognized produces no operation; when nothing survives,
// proposeContractPatch falls back to the extractor or throws
// validation_failed. It NEVER invents operations.

const PRIORITY_VALUES = ["critical", "high", "normal", "low"];
const MIN_EVIDENCE_LEVEL_VALUES = ["none", "reference", "excerpt", "hash"];
const TRUE_WORDS = new Set(["true", "是", "允许", "真"]);
const FALSE_WORDS = new Set(["false", "否", "禁止", "假"]);

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const SETTER = String.raw`(?:改为|设为|调整为|为|[:：])?`;
const CLAUSE = String.raw`([^。；;\n]+)`;

interface ParseContext {
  contract: TaskContract;
  tier: ContractSourceTier;
  owner: BoundaryOwner;
  now: string;
  ambiguities: MaterialAmbiguity[];
}

interface DirectivePattern {
  source: string;
  build: (match: RegExpExecArray, context: ParseContext) => ContractPatchOperation[];
}

const DIRECTIVE_PATTERNS: readonly DirectivePattern[] = [
  {
    source: `(?:最大工具调用)\\s*${SETTER}\\s*${NUMBER}`,
    build: (m) => [
      {
        op: "set_field",
        path: { section: "budgets", field: "maxToolCallsPerTask" },
        value: Number(m[1]),
        sourceSpan: spanOf(m),
      },
    ],
  },
  {
    source: `预算\\s*${SETTER}\\s*${NUMBER}\\s*次?\\s*工具调用`,
    build: (m) => [
      {
        op: "set_field",
        path: { section: "budgets", field: "maxToolCallsPerTask" },
        value: Number(m[1]),
        sourceSpan: spanOf(m),
      },
    ],
  },
  {
    source: `(?:最大\\s*Provider\\s*调用)\\s*${SETTER}\\s*${NUMBER}`,
    build: (m) => [
      {
        op: "set_field",
        path: { section: "budgets", field: "maxProviderCallsPerTask" },
        value: Number(m[1]),
        sourceSpan: spanOf(m),
      },
    ],
  },
  {
    source: `预算\\s*${SETTER}\\s*${NUMBER}\\s*次?\\s*(?:Provider|provider)\\s*调用`,
    build: (m) => [
      {
        op: "set_field",
        path: { section: "budgets", field: "maxProviderCallsPerTask" },
        value: Number(m[1]),
        sourceSpan: spanOf(m),
      },
    ],
  },
  {
    source: `(?:最大裁决成本|裁决成本上限)\\s*${SETTER}\\s*${NUMBER}`,
    build: (m) => [
      {
        op: "set_field",
        path: { section: "budgets", field: "maxJudgmentCostPerTask" },
        value: Number(m[1]),
        sourceSpan: spanOf(m),
      },
    ],
  },
  {
    source: `(?:标题|名称)\\s*(?:改为|设为|调整为|为|[:：])\\s*${CLAUSE}`,
    build: (m) => {
      const value = m[1]?.trim();
      if (!value) return [];
      return [
        { op: "set_field", path: { section: "title" }, value, sourceSpan: spanOf(m) },
      ];
    },
  },
  {
    source: `(?:优先级|优先级别)\\s*${SETTER}\\s*(critical|high|normal|low)`,
    build: (m) => [
      {
        op: "set_field",
        path: { section: "objective", field: "priority" },
        value: m[1],
        sourceSpan: spanOf(m),
      },
    ],
  },
  {
    source: `(?:新增|增加|添加)\\s*交付物\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) =>
      splitParts(m[1] ?? "").map((part) => ({
        ...upsertDeliverableFor(part, ctx),
        sourceSpan: spanOf(m),
      })),
  },
  {
    source: `(?:删除|移除|去掉)\\s*交付物\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) =>
      splitParts(m[1] ?? "").flatMap((part) => {
        const target =
          ctx.contract.deliverables.find((d) => d.deliverableId === part) ??
          ctx.contract.deliverables.find((d) => d.description === part);
        if (!target) {
          ctx.ambiguities.push(
            unresolvedRemoval(
              "deliverable_unclear",
              part,
              spanOf(m),
              `no deliverable matches "${part}"`,
            ),
          );
          return [];
        }
        return [
          { op: "remove_deliverable", deliverableId: target.deliverableId },
        ];
      }),
  },
  {
    source: `(?:新增|增加|添加)\\s*边界\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) => {
      const statement = (m[1] ?? "").trim();
      if (!statement) return [];
      return [
        {
          op: "add_boundary",
          boundary: {
            boundaryId: generateId(),
            kind: "scope",
            severity: "soft",
            statement,
            source: {
              type: sourceTypeOf(ctx),
              confidence: confidenceOf(ctx),
              sourceSpan: spanOf(m),
            },
            owner: ctx.owner,
            overridable: true,
            appliesTo: {},
            confidence: confidenceOf(ctx),
            status: "active",
            validFrom: ctx.now,
          },
          sourceSpan: spanOf(m),
        },
      ];
    },
  },
  {
    source: `(?:删除|移除|去掉)\\s*边界\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) => {
      const part = (m[1] ?? "").trim();
      const target =
        ctx.contract.boundaries.find((b) => b.boundaryId === part) ??
        ctx.contract.boundaries.find((b) => b.statement === part);
      if (!target) {
        ctx.ambiguities.push(
          unresolvedRemoval(
            "scope_boundary_unclear",
            part,
            spanOf(m),
            `no boundary matches "${part}"`,
          ),
        );
        return [];
      }
      return [{ op: "remove_boundary", boundaryId: target.boundaryId }];
    },
  },
  {
    source: `(?:新增|增加|添加)\\s*停止条件\\s*[:：]?\\s*${CLAUSE}`,
    build: (m) => {
      const condition = (m[1] ?? "").trim();
      if (!condition) return [];
      return [
        {
          op: "add_stop_condition",
          condition: { condition, isMet: false, evidenceRequired: false },
          sourceSpan: spanOf(m),
        },
      ];
    },
  },
  {
    source: `(?:删除|移除|去掉)\\s*停止条件\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) => {
      const part = (m[1] ?? "").trim();
      const found = ctx.contract.stopConditions.some((s) => s.condition === part);
      if (!found) {
        ctx.ambiguities.push(
          unresolvedRemoval(
            "completion_criteria_unclear",
            part,
            spanOf(m),
            `no stop condition matches "${part}"`,
          ),
        );
        return [];
      }
      return [{ op: "remove_stop_condition", condition: part }];
    },
  },
  {
    source: `(?:新增|增加|添加)\\s*假设\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) => {
      const statement = (m[1] ?? "").trim();
      if (!statement) return [];
      return [
        {
          op: "add_assumption",
          assumption: {
            statement,
            source: sourceTypeOf(ctx),
            confidence: confidenceOf(ctx),
            status: "active",
          },
          sourceSpan: spanOf(m),
        },
      ];
    },
  },
  {
    source: `(?:删除|移除|去掉)\\s*假设\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) => {
      const part = (m[1] ?? "").trim();
      const found = ctx.contract.assumptions.some((a) => a.statement === part);
      if (!found) {
        ctx.ambiguities.push(
          unresolvedRemoval(
            "scope_boundary_unclear",
            part,
            spanOf(m),
            `no assumption matches "${part}"`,
          ),
        );
        return [];
      }
      return [{ op: "remove_assumption", statement: part }];
    },
  },
  {
    source: `(?:新增|增加|添加)\\s*(范围外|范围内|范围)\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) => {
      const outbound = m[1] === "范围外";
      const statement = (m[2] ?? "").trim();
      if (!statement) return [];
      return [
        {
          op: outbound ? "add_scope_out" : "add_scope_in",
          item: {
            statement,
            source: sourceTypeOf(ctx),
            appliesTo: {},
            readonly: false,
            writable: true,
            outbound,
            confidence: confidenceOf(ctx),
          },
          sourceSpan: spanOf(m),
        },
      ];
    },
  },
  {
    source: `(?:删除|移除|去掉)\\s*(范围外|范围内|范围)\\s*[:：]?\\s*${CLAUSE}`,
    build: (m, ctx) => {
      const outbound = m[1] === "范围外";
      const statement = (m[2] ?? "").trim();
      const list = outbound ? ctx.contract.scope.out : ctx.contract.scope.in;
      const found = list.some((item) => item.statement === statement);
      if (!found) {
        ctx.ambiguities.push(
          unresolvedRemoval(
            "scope_boundary_unclear",
            statement,
            spanOf(m),
            `no scope item matches "${statement}"`,
          ),
        );
        return [];
      }
      return [
        {
          op: outbound ? "remove_scope_out" : "remove_scope_in",
          statement,
        },
      ];
    },
  },
  {
    source:
      `(executorCanChooseMethods|executorCanProposeScope|executorCanSelfReview|` +
      `overridesRequireUserConfirmation|requireSourceForClaims|allowUserTestimony)` +
      `\\s*${SETTER}\\s*(true|false|是|否|允许|禁止|真|假)`,
    build: (m) => {
      const field = m[1];
      const word = m[2];
      if (!field || !word) return [];
      const value = TRUE_WORDS.has(word) ? true : FALSE_WORDS.has(word) ? false : undefined;
      if (value === undefined) return [];
      const section =
        field === "requireSourceForClaims" || field === "allowUserTestimony"
          ? "evidencePolicy"
          : "authority";
      return [
        {
          op: "set_field",
          path: { section, field } as ContractFieldPath,
          value,
          sourceSpan: spanOf(m),
        },
      ];
    },
  },
  {
    source: `(minEvidenceLevel)\\s*${SETTER}\\s*(none|reference|excerpt|hash)`,
    build: (m) => [
      {
        op: "set_field",
        path: { section: "evidencePolicy", field: "minEvidenceLevel" },
        value: m[2],
        sourceSpan: spanOf(m),
      },
    ],
  },
];

function spanOf(match: RegExpExecArray): SourceSpan {
  const full = match[0] || "";
  return { start: match.index, end: match.index + full.length };
}

function splitParts(text: string): string[] {
  return text
    .split(/[、,，]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function clampExcerpt(text: string): string {
  return text.length > 2000 ? text.slice(0, 2000) : text;
}

function confidenceOf(context: ParseContext): number {
  return context.tier === "user_directive" ? 1 : 0.5;
}

function sourceTypeOf(context: ParseContext): "user_directive" | "inferred" {
  return context.tier === "user_directive" ? "user_directive" : "inferred";
}

function upsertDeliverableFor(
  description: string,
  context: ParseContext,
): ContractPatchOperation {
  const existing = context.contract.deliverables.find(
    (d) => d.description === description,
  );
  const deliverable: Deliverable = existing
    ? { ...existing, description }
    : {
        deliverableId: generateId(),
        description,
        acceptanceChecks: [],
        required: true,
        status: "not_started",
        evidenceRefs: [],
      };
  return { op: "upsert_deliverable", deliverable };
}

function unresolvedRemoval(
  kind: MaterialAmbiguity["kind"],
  part: string,
  span: SourceSpan,
  description: string,
): MaterialAmbiguity {
  return {
    ambiguityId: generateId(),
    kind,
    description,
    excerpt: clampExcerpt(part),
    sourceSpans: [span],
    decisionRequired: true,
  };
}

interface ParsedDirectives {
  ops: ContractPatchOperation[];
  ambiguities: MaterialAmbiguity[];
}

/** Removal variants carry no sourceSpan; presence variants carry an optional one. */
function operationSpan(op: ContractPatchOperation): SourceSpan | undefined {
  return "sourceSpan" in op ? op.sourceSpan : undefined;
}

function parseExplicitDirectives(
  contract: TaskContract,
  instruction: string,
  tier: ContractSourceTier,
  owner: BoundaryOwner,
  now: string,
): ParsedDirectives {
  const context: ParseContext = { contract, tier, owner, now, ambiguities: [] };
  const found: { start: number; end: number; ops: ContractPatchOperation[] }[] = [];
  for (const pattern of DIRECTIVE_PATTERNS) {
    const regexp = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regexp.exec(instruction)) !== null) {
      const full = match[0] || "";
      if (full.length === 0) {
        regexp.lastIndex += 1;
        continue;
      }
      found.push({
        start: match.index,
        end: match.index + full.length,
        ops: pattern.build(match, context),
      });
    }
  }
  // Overlapping directives: the first match wins the range (e.g. a title that
  // happens to contain the words of another directive stays a title).
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: { start: number; end: number; ops: ContractPatchOperation[] }[] = [];
  for (const candidate of found) {
    const overlaps = accepted.some(
      (a) => candidate.start < a.end && candidate.end > a.start,
    );
    if (!overlaps) accepted.push(candidate);
  }

  // A bare budget amount with no unit is a high-impact ambiguity, not a
  // silently guessed field.
  const bareBudget = new RegExp(`预算\\s*${SETTER}\\s*${NUMBER}`, "g");
  let budgetMatch: RegExpExecArray | null;
  while ((budgetMatch = bareBudget.exec(instruction)) !== null) {
    const full = budgetMatch[0] || "";
    const start = budgetMatch.index;
    const end = start + full.length;
    const covered = accepted.some((a) => start < a.end && end > a.start);
    if (!covered) {
      context.ambiguities.push({
        ambiguityId: generateId(),
        kind: "budget_unclear",
        description: `budget amount "${full}" has no unit — tool calls, Provider calls or judgment cost unclear`,
        excerpt: clampExcerpt(full),
        sourceSpans: [{ start, end }],
        decisionRequired: true,
      });
    }
  }

  const ops = accepted.flatMap((a) => a.ops);
  const resolved = resolveDuplicateDirectives(ops, instruction);
  return { ops: resolved.ops, ambiguities: [...context.ambiguities, ...resolved.ambiguities] };
}

/**
 * Deterministic handling of repeated directives inside one instruction:
 * an exact repeat is deduplicated; two different directives on the same
 * logical field keep the last one and surface a conflicting_directives
 * MaterialAmbiguity with decisionRequired.
 */
function resolveDuplicateDirectives(
  ops: ContractPatchOperation[],
  instruction: string,
): { ops: ContractPatchOperation[]; ambiguities: MaterialAmbiguity[] } {
  const byKey = new Map<string, ContractPatchOperation>();
  const spansByKey = new Map<string, SourceSpan[]>();
  const kept: ContractPatchOperation[] = [];
  const ambiguities: MaterialAmbiguity[] = [];
  for (const op of ops) {
    const info = patchOperationFieldKey(op);
    const previous = byKey.get(info.key);
    if (!previous) {
      byKey.set(info.key, op);
      const span = operationSpan(op);
      spansByKey.set(info.key, span ? [span] : []);
      kept.push(op);
      continue;
    }
    if (JSON.stringify(previous) === JSON.stringify(op)) continue;
    const index = kept.indexOf(previous);
    if (index >= 0) kept.splice(index, 1);
    const currentSpan = operationSpan(op);
    const spans = [
      ...(spansByKey.get(info.key) ?? []),
      ...(currentSpan ? [currentSpan] : []),
    ].sort((a, b) => a.start - b.start);
    spansByKey.set(info.key, spans);
    byKey.set(info.key, op);
    kept.push(op);
    const spanList = spans.length > 0 ? spans : [{ start: 0, end: 0 }];
    const excerptStart = Math.min(...spanList.map((s) => s.start));
    const excerptEnd = Math.max(...spanList.map((s) => s.end));
    ambiguities.push({
      ambiguityId: generateId(),
      kind: "conflicting_directives",
      description: `instruction contains conflicting directives on ${info.label}`,
      excerpt: clampExcerpt(instruction.slice(excerptStart, excerptEnd)),
      sourceSpans: spanList,
      decisionRequired: true,
    });
  }
  return { ops: kept, ambiguities };
}

// ── Logical field identity (shared with the merge layer) ──
//
// A "logical field" is the unit of merge conflict detection. Scalar fields
// are keyed by their whitelisted path; array items are keyed by identity
// (deliverableId / boundaryId / statement / condition). Presence and removal
// of the same identity share one key, so add-vs-remove on one identity is a
// conflict on the same logical field rather than two independent edits.

export interface PatchFieldKey {
  key: string;
  label: string;
}

export function patchOperationFieldKey(op: ContractPatchOperation): PatchFieldKey {
  switch (op.op) {
    case "set_field": {
      const name = pathName(op.path);
      return { key: `set:${name}`, label: `field ${name}` };
    }
    case "upsert_deliverable":
      return {
        key: `deliverable:${op.deliverable.deliverableId}`,
        label: `deliverable ${op.deliverable.deliverableId}`,
      };
    case "remove_deliverable":
      return {
        key: `deliverable:${op.deliverableId}`,
        label: `deliverable ${op.deliverableId}`,
      };
    case "add_scope_in":
      return {
        key: `scope_in:${op.item.statement}`,
        label: `scope-in statement "${op.item.statement}"`,
      };
    case "remove_scope_in":
      return {
        key: `scope_in:${op.statement}`,
        label: `scope-in statement "${op.statement}"`,
      };
    case "add_scope_out":
      return {
        key: `scope_out:${op.item.statement}`,
        label: `scope-out statement "${op.item.statement}"`,
      };
    case "remove_scope_out":
      return {
        key: `scope_out:${op.statement}`,
        label: `scope-out statement "${op.statement}"`,
      };
    case "add_boundary":
      return {
        key: `boundary:${op.boundary.boundaryId}`,
        label: `boundary ${op.boundary.boundaryId}`,
      };
    case "remove_boundary":
      return {
        key: `boundary:${op.boundaryId}`,
        label: `boundary ${op.boundaryId}`,
      };
    case "add_stop_condition":
      return {
        key: `stop:${op.condition.condition}`,
        label: `stop condition "${op.condition.condition}"`,
      };
    case "remove_stop_condition":
      return {
        key: `stop:${op.condition}`,
        label: `stop condition "${op.condition}"`,
      };
    case "add_assumption":
      return {
        key: `assumption:${op.assumption.statement}`,
        label: `assumption "${op.assumption.statement}"`,
      };
    case "remove_assumption":
      return {
        key: `assumption:${op.statement}`,
        label: `assumption "${op.statement}"`,
      };
    case "append_correction_ref":
      return {
        key: `correction:${op.correctionId}`,
        label: `correction ${op.correctionId}`,
      };
    case "add_preauthorization":
      return {
        key: `preauth:${op.preauthorization.preauthorizationId}`,
        label: `preauthorization ${op.preauthorization.preauthorizationId}`,
      };
    case "supersede_preauthorization":
      return {
        key: `preauth:${op.preauthorizationId}`,
        label: `preauthorization ${op.preauthorizationId}`,
      };
  }
}

function pathName(path: ContractFieldPath): string {
  return "field" in path ? `${path.section}.${path.field}` : path.section;
}

// ── Operation application ──

export interface ApplyOperationsOptions {
  /**
   * Strict mode (applyContractPatch): removing an absent identity and
   * introducing a duplicate identity throw validation_failed. Lenient mode
   * (merge preview): those cases are no-ops or identity upserts so a merged
   * display view never fails on a patch that only matters in combination.
   * set_field values are validated in BOTH modes.
   */
  strict: boolean;
}

type FieldValidator = (value: unknown) => boolean;

function stringOfLength(min: number, max: number): FieldValidator {
  return (value) =>
    typeof value === "string" && value.length >= min && value.length <= max;
}

function positiveInteger(): FieldValidator {
  return (value) =>
    typeof value === "number" && Number.isInteger(value) && value > 0;
}

function positiveNumber(): FieldValidator {
  return (value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
}

function booleanValue(): FieldValidator {
  return (value) => typeof value === "boolean";
}

function oneOf(values: readonly string[]): FieldValidator {
  const set = new Set(values);
  return (value) => typeof value === "string" && set.has(value);
}

// Mirrors the field constraints declared by the schema package: an object
// value can never pass, which defeats prototype-pollution payloads before
// any assignment happens.
const FIELD_VALIDATORS: Record<string, FieldValidator> = {
  title: stringOfLength(1, 500),
  "objective.primary": stringOfLength(1, 2000),
  "objective.rationale": stringOfLength(0, 5000),
  "objective.priority": oneOf(PRIORITY_VALUES),
  "objective.successSignal": stringOfLength(0, 2000),
  "budgets.maxToolCallsPerTask": positiveInteger(),
  "budgets.maxProviderCallsPerTask": positiveInteger(),
  "budgets.maxJudgmentCostPerTask": positiveNumber(),
  "authority.executorCanChooseMethods": booleanValue(),
  "authority.executorCanProposeScope": booleanValue(),
  "authority.executorCanSelfReview": booleanValue(),
  "authority.overridesRequireUserConfirmation": booleanValue(),
  "evidencePolicy.requireSourceForClaims": booleanValue(),
  "evidencePolicy.minEvidenceLevel": oneOf(MIN_EVIDENCE_LEVEL_VALUES),
  "evidencePolicy.allowUserTestimony": booleanValue(),
};

function setFieldValue(
  working: TaskContract,
  path: ContractFieldPath,
  value: unknown,
): void {
  switch (path.section) {
    case "title":
      working.title = value as string;
      break;
    case "objective": {
      const record = working.objective as unknown as Record<string, unknown>;
      record[path.field] = value;
      break;
    }
    case "budgets": {
      const record = working.budgets as unknown as Record<string, unknown>;
      record[path.field] = value;
      break;
    }
    case "authority": {
      const record = working.authority as unknown as Record<string, unknown>;
      record[path.field] = value;
      break;
    }
    case "evidencePolicy": {
      const record = working.evidencePolicy as unknown as Record<string, unknown>;
      record[path.field] = value;
      break;
    }
  }
}

function duplicateIdentityError(
  op: ContractPatchOperation["op"],
  identity: Record<string, unknown>,
): SestinaError {
  return new SestinaError(
    SestinaErrorCode.validation_failed,
    "duplicate identity within the proposal",
    undefined,
    { op, ...identity },
  );
}

function absentIdentityError(
  op: ContractPatchOperation["op"],
  identity: Record<string, unknown>,
): SestinaError {
  return new SestinaError(
    SestinaErrorCode.validation_failed,
    "cannot remove an absent identity",
    undefined,
    { op, ...identity },
  );
}

/**
 * Applies operations to a fresh deep copy of the contract and returns it.
 * The input contract is never mutated. Shared by applyContractPatch (strict)
 * and mergeConcurrentPatches (lenient replay for the display view).
 */
export function applyPatchOperations(
  contract: TaskContract,
  operations: readonly ContractPatchOperation[],
  options: ApplyOperationsOptions,
): TaskContract {
  const { strict } = options;
  const working = structuredClone(contract);
  const seen = {
    deliverableIds: new Set<string>(),
    boundaryIds: new Set<string>(),
    scopeIn: new Set<string>(),
    scopeOut: new Set<string>(),
    stopConditions: new Set<string>(),
    assumptions: new Set<string>(),
    preauthorizationIds: new Set<string>(),
  };

  for (const op of operations) {
    switch (op.op) {
      case "set_field": {
        const path = op.path;
        const name = pathName(path);
        const validator = FIELD_VALIDATORS[name];
        const value = op.value;
        if (value === undefined || !validator?.(value)) {
          throw new SestinaError(
            SestinaErrorCode.validation_failed,
            `set_field value is invalid for ${name}`,
            undefined,
            { op: "set_field", path: op.path, value },
          );
        }
        setFieldValue(working, path, value);
        break;
      }
      case "upsert_deliverable": {
        const id = op.deliverable.deliverableId;
        if (seen.deliverableIds.has(id) && strict) {
          throw duplicateIdentityError("upsert_deliverable", { deliverableId: id });
        }
        seen.deliverableIds.add(id);
        const index = working.deliverables.findIndex((d) => d.deliverableId === id);
        if (index >= 0) working.deliverables[index] = op.deliverable;
        else working.deliverables.push(op.deliverable);
        break;
      }
      case "remove_deliverable": {
        const index = working.deliverables.findIndex(
          (d) => d.deliverableId === op.deliverableId,
        );
        if (index < 0) {
          if (strict) {
            throw absentIdentityError("remove_deliverable", {
              deliverableId: op.deliverableId,
            });
          }
          break;
        }
        working.deliverables.splice(index, 1);
        break;
      }
      case "add_scope_in": {
        const statement = op.item.statement;
        const existing = working.scope.in.findIndex((i) => i.statement === statement);
        if (seen.scopeIn.has(statement) && strict) {
          throw duplicateIdentityError("add_scope_in", { statement });
        }
        seen.scopeIn.add(statement);
        if (existing >= 0) {
          if (strict) {
            throw duplicateIdentityError("add_scope_in", { statement });
          }
          working.scope.in[existing] = op.item;
        } else {
          working.scope.in.push(op.item);
        }
        break;
      }
      case "add_scope_out": {
        const statement = op.item.statement;
        const existing = working.scope.out.findIndex((i) => i.statement === statement);
        if (seen.scopeOut.has(statement) && strict) {
          throw duplicateIdentityError("add_scope_out", { statement });
        }
        seen.scopeOut.add(statement);
        if (existing >= 0) {
          if (strict) {
            throw duplicateIdentityError("add_scope_out", { statement });
          }
          working.scope.out[existing] = op.item;
        } else {
          working.scope.out.push(op.item);
        }
        break;
      }
      case "remove_scope_in": {
        const index = working.scope.in.findIndex(
          (i) => i.statement === op.statement,
        );
        if (index < 0) {
          if (strict) {
            throw absentIdentityError("remove_scope_in", { statement: op.statement });
          }
          break;
        }
        working.scope.in.splice(index, 1);
        break;
      }
      case "remove_scope_out": {
        const index = working.scope.out.findIndex(
          (i) => i.statement === op.statement,
        );
        if (index < 0) {
          if (strict) {
            throw absentIdentityError("remove_scope_out", { statement: op.statement });
          }
          break;
        }
        working.scope.out.splice(index, 1);
        break;
      }
      case "add_boundary": {
        const id = op.boundary.boundaryId;
        const existing = working.boundaries.findIndex((b) => b.boundaryId === id);
        if (seen.boundaryIds.has(id) && strict) {
          throw duplicateIdentityError("add_boundary", { boundaryId: id });
        }
        seen.boundaryIds.add(id);
        if (existing >= 0) {
          if (strict) {
            throw duplicateIdentityError("add_boundary", { boundaryId: id });
          }
          working.boundaries[existing] = op.boundary;
        } else {
          working.boundaries.push(op.boundary);
        }
        break;
      }
      case "remove_boundary": {
        const index = working.boundaries.findIndex(
          (b) => b.boundaryId === op.boundaryId,
        );
        if (index < 0) {
          if (strict) {
            throw absentIdentityError("remove_boundary", { boundaryId: op.boundaryId });
          }
          break;
        }
        working.boundaries.splice(index, 1);
        break;
      }
      case "add_stop_condition": {
        const condition = op.condition.condition;
        const existing = working.stopConditions.findIndex(
          (s) => s.condition === condition,
        );
        if (seen.stopConditions.has(condition) && strict) {
          throw duplicateIdentityError("add_stop_condition", { condition });
        }
        seen.stopConditions.add(condition);
        if (existing >= 0) {
          if (strict) {
            throw duplicateIdentityError("add_stop_condition", { condition });
          }
          working.stopConditions[existing] = op.condition;
        } else {
          working.stopConditions.push(op.condition);
        }
        break;
      }
      case "remove_stop_condition": {
        const index = working.stopConditions.findIndex(
          (s) => s.condition === op.condition,
        );
        if (index < 0) {
          if (strict) {
            throw absentIdentityError("remove_stop_condition", { condition: op.condition });
          }
          break;
        }
        working.stopConditions.splice(index, 1);
        break;
      }
      case "add_assumption": {
        const statement = op.assumption.statement;
        const existing = working.assumptions.findIndex(
          (a) => a.statement === statement,
        );
        if (seen.assumptions.has(statement) && strict) {
          throw duplicateIdentityError("add_assumption", { statement });
        }
        seen.assumptions.add(statement);
        if (existing >= 0) {
          if (strict) {
            throw duplicateIdentityError("add_assumption", { statement });
          }
          working.assumptions[existing] = op.assumption;
        } else {
          working.assumptions.push(op.assumption);
        }
        break;
      }
      case "remove_assumption": {
        const index = working.assumptions.findIndex(
          (a) => a.statement === op.statement,
        );
        if (index < 0) {
          if (strict) {
            throw absentIdentityError("remove_assumption", { statement: op.statement });
          }
          break;
        }
        working.assumptions.splice(index, 1);
        break;
      }
      case "append_correction_ref": {
        if (working.correctionRefs.includes(op.correctionId)) {
          if (strict) {
            throw duplicateIdentityError("append_correction_ref", {
              correctionId: op.correctionId,
            });
          }
          break;
        }
        working.correctionRefs.push(op.correctionId);
        break;
      }
      case "add_preauthorization": {
        const id = op.preauthorization.preauthorizationId;
        const list = working.preauthorizations ?? [];
        const existing = list.findIndex((p) => p.preauthorizationId === id);
        if ((seen.preauthorizationIds.has(id) || existing >= 0) && strict) {
          throw duplicateIdentityError("add_preauthorization", { preauthorizationId: id });
        }
        seen.preauthorizationIds.add(id);
        if (existing >= 0) list[existing] = op.preauthorization;
        else list.push(op.preauthorization);
        working.preauthorizations = list;
        break;
      }
      case "supersede_preauthorization": {
        const list = working.preauthorizations ?? [];
        const index = list.findIndex(
          (p) => p.preauthorizationId === op.preauthorizationId,
        );
        if (index < 0) {
          if (strict) {
            throw absentIdentityError("supersede_preauthorization", {
              preauthorizationId: op.preauthorizationId,
            });
          }
          break;
        }
        working.preauthorizations = list.map((p, i) =>
          i === index ? { ...p, status: "superseded" } : p,
        );
        break;
      }
    }
  }
  return working;
}

// ── Propose ──

function parseProposalSafely(proposal: ContractPatchProposal): ContractPatchProposal {
  const parsed = ContractPatchProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "proposal does not satisfy the contract patch proposal schema",
      undefined,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/**
 * Deterministic parser over the instruction. Recognizes ONLY explicit
 * directives on whitelisted paths. Anything unrecognized: when an extractor
 * is provided its proposal's operations are included (inferred tier, always
 * — extractor output is inference regardless of the actor); otherwise
 * validation_failed is thrown. Never invents operations. Direct-user actors
 * (canActAsDirectUser) author user_directive proposals; peers can never
 * author user directives.
 */
export function proposeContractPatch(input: PatchProposalInput): ContractPatchProposal {
  const { contract, instruction, actor, createdAt } = input;
  const directUser = canActAsDirectUser(actor);
  let tier: ContractSourceTier = directUser ? "user_directive" : "inferred";
  let owner: BoundaryOwner = directUser ? "user" : "inferred";
  let { ops, ambiguities } = parseExplicitDirectives(
    contract,
    instruction,
    tier,
    owner,
    createdAt,
  );
  let sourceRefs: SourceRef[] = [...(input.sourceRefs ?? [])];

  if (ops.length === 0) {
    const extractor = input.extractor;
    if (!extractor) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "no explicit patch operations recognized",
      );
    }
    const extracted = extractor.propose({
      contract,
      sourceText: instruction,
      now: input.now ?? createdAt,
    });
    if (extracted !== undefined) {
      const validated = parseProposalSafely(extracted);
      if (
        validated.contractId !== contract.contractId ||
        validated.taskId !== contract.taskId ||
        validated.expectedVersion !== contract.version
      ) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "extractor proposal does not match the contract",
          undefined,
          {
            contractId: validated.contractId,
            taskId: validated.taskId,
            expectedVersion: validated.expectedVersion,
          },
        );
      }
      ops = validated.operations;
      ambiguities = [...ambiguities, ...validated.ambiguities];
      sourceRefs = [...sourceRefs, ...validated.sourceRefs];
      tier = "inferred";
      owner = "inferred";
    }
    if (ops.length === 0) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "no explicit patch operations recognized",
      );
    }
  }

  const proposal: ContractPatchProposal = {
    schemaVersion: "1.0.0",
    proposalId: input.proposalId ?? generateId(),
    contractId: contract.contractId,
    taskId: contract.taskId,
    expectedVersion: contract.version,
    operations: ops,
    sourceTier: tier,
    owner,
    sourceRefs,
    ambiguities,
    createdAt,
  };
  return parseProposalSafely(proposal);
}

// ── Apply ──

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object") deepFreeze(child);
    }
  }
  return value;
}

/**
 * Validates the proposal (schema, contract identity, expectedVersion),
 * deep-freezes both inputs, and applies every operation to a fresh deep
 * copy. The result is exactly one version ahead of the contract, with
 * updatedAt stamped from the proposal's createdAt; contractId, taskId,
 * createdAt, sourceRefs and correctionRefs are carried over unchanged.
 * Inputs are asserted unchanged afterward — a mutating apply is a bug, not
 * a feature.
 */
export function applyContractPatch(
  contract: TaskContract,
  proposal: ContractPatchProposal,
): TaskContract {
  const validated = parseProposalSafely(proposal);
  if (
    validated.contractId !== contract.contractId ||
    validated.taskId !== contract.taskId
  ) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "proposal contract identity does not match the contract",
      undefined,
      {
        actual: { contractId: validated.contractId, taskId: validated.taskId },
        expected: { contractId: contract.contractId, taskId: contract.taskId },
      },
    );
  }
  assertExpectedVersion(contract, validated.expectedVersion);

  deepFreeze(contract);
  deepFreeze(proposal);
  deepFreeze(validated);
  const contractSnapshot = JSON.stringify(contract);
  const proposalSnapshot = JSON.stringify(validated);

  const result = applyPatchOperations(contract, validated.operations, {
    strict: true,
  });
  result.version = nextContractVersion(contract);
  result.updatedAt = validated.createdAt;

  if (
    JSON.stringify(contract) !== contractSnapshot ||
    JSON.stringify(validated) !== proposalSnapshot
  ) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "input mutation detected during apply",
    );
  }

  const parsed = TaskContractSchema.safeParse(result);
  if (!parsed.success) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "applied contract failed schema validation",
      undefined,
      parsed.error.issues,
    );
  }
  return parsed.data;
}
