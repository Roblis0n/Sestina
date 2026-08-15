import { describe, expect, it } from "vitest";
import { SestinaError, SestinaErrorCode, TaskContractSchema } from "@sestina/schema";
import type {
  Assumption,
  BoundaryKind,
  ContractId,
  HandoffPreauthorization,
  ProjectId,
  SourceRef,
  StopCondition,
  TaskContract,
  TaskId,
} from "@sestina/schema";
import { summarizeContract, type ContractSummary } from "../src/summarize.js";

// ── Deterministic test ids (no randomness) ──
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function deterministicId(seed: number): string {
  // Numerical Recipes LCG, full period 2^32; top 5 bits extracted per character.
  let x = Math.imul(seed + 1, 0x9e3779b9) >>> 0;
  let out = "";
  for (let i = 0; i < 26; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += CROCKFORD_ALPHABET[(x >>> 27) & 31] ?? "0";
  }
  return out;
}

const NOW = "2026-08-15T00:00:00.000Z";

function utf8(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Rebuilds the rendered summary exactly the way the contract defines it. */
function renderedOf(summary: ContractSummary): string {
  const parts: string[] = [];
  if (summary.objective !== "") parts.push(summary.objective);
  parts.push(...summary.deliverables);
  parts.push(...summary.boundaries);
  return parts.join("\n");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function directUserProvenance() {
  return { actor: "user" as const, channel: "desktop" as const, directUser: true };
}

function makePreauthorization(): HandoffPreauthorization {
  return {
    schemaVersion: "1.0.0",
    preauthorizationId: deterministicId(500),
    projectId: deterministicId(1) as ProjectId,
    taskId: deterministicId(2) as TaskId,
    source: { host: "codex", endpointId: deterministicId(10) },
    target: { host: "claude_code", endpointId: deterministicId(11) },
    deliverableIds: [deterministicId(20)],
    pathScope: ["outputs"],
    actionCategories: ["read", "write"],
    contractVersion: 1,
    status: "active",
    confirmedBy: directUserProvenance(),
    confirmedAt: NOW,
  };
}

interface ContractOverrides {
  objective?: string;
  title?: string;
  deliverables?: string[];
  boundaries?: { kind: BoundaryKind; statement: string }[];
  sourceRefs?: SourceRef[];
  correctionRefs?: string[];
  preauthorizations?: HandoffPreauthorization[];
  stopConditions?: StopCondition[];
  assumptions?: Assumption[];
}

function makeContract(overrides: ContractOverrides = {}): TaskContract {
  const base: TaskContract = {
    schemaVersion: "1.0.0",
    contractId: deterministicId(1) as ContractId,
    taskId: deterministicId(2) as TaskId,
    version: 3,
    status: "active",
    title: overrides.title ?? "契约历史标题XYZ",
    objective: {
      primary: overrides.objective ?? "完成主题分析《Sestina 合同编译》",
      priority: "normal",
    },
    deliverables: (overrides.deliverables ?? [
      "主题分析报告（需包含数据来源）",
      "风险核查清单",
    ]).map((description, index) => ({
      deliverableId: deterministicId(100 + index),
      description,
      acceptanceChecks: [],
      required: true,
      status: "not_started",
      evidenceRefs: [],
    })),
    scope: { in: [], out: [] },
    boundaries: (overrides.boundaries ?? []).map((boundary, index) => ({
      boundaryId: deterministicId(200 + index),
      kind: boundary.kind,
      severity: "hard",
      statement: boundary.statement,
      source: { type: "user_directive", confidence: 1 },
      owner: "user",
      overridable: false,
      appliesTo: {},
      confidence: 1,
      status: "active",
      validFrom: NOW,
    })),
    evidencePolicy: {
      requireSourceForClaims: true,
      minEvidenceLevel: "reference",
      allowUserTestimony: true,
    },
    authority: {
      executorCanChooseMethods: true,
      executorCanProposeScope: true,
      executorCanSelfReview: false,
      overridesRequireUserConfirmation: true,
    },
    budgets: {},
    stopConditions: overrides.stopConditions ?? [],
    assumptions: overrides.assumptions ?? [],
    correctionRefs: overrides.correctionRefs ?? [],
    sourceRefs: overrides.sourceRefs ?? [],
    preauthorizations: overrides.preauthorizations ?? [],
    createdAt: NOW,
    updatedAt: NOW,
  };
  return TaskContractSchema.parse(base);
}

describe("summarizeContract (Task 9 §十 contract summary)", () => {
  it("keeps the fixed order objective → deliverables → boundaries", () => {
    const contract = makeContract({
      boundaries: [
        { kind: "scope", statement: "只允许写入 ./outputs/ 目录" },
        { kind: "privacy", statement: "不要修改 data/ 目录之外的文件" },
      ],
    });
    const summary = summarizeContract(contract, 1_000_000);

    expect(summary.objective).toBe(contract.objective.primary);
    expect(summary.deliverables).toEqual([
      "主题分析报告（需包含数据来源）",
      "风险核查清单",
    ]);
    expect(summary.boundaries).toEqual([
      "只允许写入 ./outputs/ 目录",
      "不要修改 data/ 目录之外的文件",
    ]);
    expect(summary.omittedDeliverables).toBe(0);
    expect(summary.omittedBoundaries).toBe(0);
    expect(summary.truncated).toBe(false);

    const rendered = renderedOf(summary);
    expect(rendered.indexOf(contract.objective.primary)).toBe(0);
    const deliverableIndex1 = rendered.indexOf("主题分析报告（需包含数据来源）");
    const deliverableIndex2 = rendered.indexOf("风险核查清单");
    const boundaryIndex1 = rendered.indexOf("只允许写入 ./outputs/ 目录");
    const boundaryIndex2 = rendered.indexOf("不要修改 data/ 目录之外的文件");
    expect(deliverableIndex1).toBeGreaterThan(0);
    expect(deliverableIndex2).toBeGreaterThan(deliverableIndex1);
    expect(boundaryIndex1).toBeGreaterThan(deliverableIndex2);
    expect(boundaryIndex2).toBeGreaterThan(boundaryIndex1);
    expect(summary.utf8Bytes).toBe(utf8(rendered));
  });

  it("honors the UTF-8 byte budget with Chinese and emoji content and never splits items", () => {
    const contract = makeContract({
      boundaries: [
        { kind: "action", statement: "核查不得替代主任务 🚀📝" },
        { kind: "scope", statement: "只允许写入 ./outputs/ 目录" },
      ],
    });
    const firstDeliverable = contract.deliverables[0]?.description ?? "";

    // Budget = exactly objective + first deliverable: everything after is dropped whole.
    const tightBudget = utf8(contract.objective.primary) + 1 + utf8(firstDeliverable);
    const tight = summarizeContract(contract, tightBudget);
    expect(tight.objective).toBe(contract.objective.primary);
    expect(tight.deliverables).toEqual([firstDeliverable]);
    expect(tight.boundaries).toEqual([]);
    expect(tight.omittedDeliverables).toBe(1);
    expect(tight.omittedBoundaries).toBe(2);
    expect(tight.truncated).toBe(true);
    const tightRendered = renderedOf(tight);
    expect(tight.utf8Bytes).toBe(utf8(tightRendered));
    expect(tight.utf8Bytes).toBe(tightBudget);
    expect(tight.utf8Bytes).toBeLessThanOrEqual(tightBudget);
    // The emoji-carrying boundary was dropped as a whole unit, never partially copied.
    expect(tightRendered).not.toContain("🚀📝");

    // Larger budget: the emoji boundary fits whole and is copied byte-exactly.
    const emojiBoundary = "核查不得替代主任务 🚀📝";
    const secondDeliverable = contract.deliverables[1]?.description ?? "";
    const roomyBudget =
      utf8(contract.objective.primary) +
      1 +
      utf8(firstDeliverable) +
      1 +
      utf8(secondDeliverable) +
      1 +
      utf8(emojiBoundary);
    const roomy = summarizeContract(contract, roomyBudget);
    const roomyRendered = renderedOf(roomy);
    expect(roomy.boundaries).toEqual([emojiBoundary]);
    expect(roomy.omittedBoundaries).toBe(1);
    expect(roomy.utf8Bytes).toBe(roomyBudget);
    expect(roomy.utf8Bytes).toBeLessThanOrEqual(roomyBudget);
    expect(roomyRendered).toContain("🚀📝");

    // Every included item is the whole source string — no mid-character or mid-item cut.
    for (const item of [...roomy.deliverables, ...roomy.boundaries]) {
      const fromDeliverable = contract.deliverables.some((d) => d.description === item);
      const fromBoundary = contract.boundaries.some((b) => b.statement === item);
      expect(fromDeliverable || fromBoundary).toBe(true);
    }
    expect(roomyRendered).toBe(
      [contract.objective.primary, firstDeliverable, secondDeliverable, emojiBoundary].join("\n"),
    );
  });

  it("drops whole items and reports exact omission counts when the budget is tiny", () => {
    const contract = makeContract({
      objective: "完成主题分析《Sestina 合同编译》",
      deliverables: ["报告A", "清单B"],
      boundaries: [{ kind: "scope", statement: "只允许写入 ./outputs/ 目录" }],
    });
    const budget = utf8("报告A") + 1;
    const summary = summarizeContract(contract, budget);

    expect(summary.objective).toBe("");
    expect(summary.deliverables).toEqual(["报告A"]);
    expect(summary.boundaries).toEqual([]);
    expect(summary.omittedDeliverables).toBe(1);
    expect(summary.omittedBoundaries).toBe(1);
    expect(summary.truncated).toBe(true);

    const rendered = renderedOf(summary);
    expect(summary.utf8Bytes).toBe(utf8(rendered));
    expect(summary.utf8Bytes).toBeLessThanOrEqual(budget);
    expect(summary.utf8Bytes).toBe(utf8("报告A"));
  });

  it("omits the objective entirely when it alone exceeds the budget", () => {
    const contract = makeContract({
      objective: "完成主题分析《Sestina 合同编译》",
      deliverables: ["报告A", "清单B"],
    });
    const budget = utf8(contract.objective.primary) - 1;
    const summary = summarizeContract(contract, budget);

    expect(summary.objective).toBe("");
    expect(summary.truncated).toBe(true);
    expect(summary.utf8Bytes).toBeLessThanOrEqual(budget);
    expect(summary.utf8Bytes).toBe(utf8(renderedOf(summary)));
  });

  it("omits absolute personal path boundaries and keeps project-relative paths", () => {
    const contract = makeContract({
      boundaries: [
        { kind: "scope", statement: "只允许写入 ./outputs/ 目录" },
        { kind: "privacy", statement: "不得修改 C:\\Users\\Someone\\Documents\\notes.txt" },
        { kind: "privacy", statement: "参考 /home/alice/notes.txt 即可" },
        { kind: "scope", statement: "不要修改 data/ 目录之外的文件" },
        { kind: "privacy", statement: "归档在 D:\\projects\\archive\\" },
        { kind: "privacy", statement: "配置位于 /Users/bob/.config/sestina" },
        { kind: "privacy", statement: "请勿触碰 /root/.ssh/ 内容" },
      ],
    });
    const summary = summarizeContract(contract, 1_000_000);

    expect(summary.boundaries).toEqual([
      "只允许写入 ./outputs/ 目录",
      "不要修改 data/ 目录之外的文件",
    ]);
    expect(summary.omittedBoundaries).toBe(5);
    expect(summary.truncated).toBe(true);

    const rendered = renderedOf(summary);
    expect(rendered).toContain("./outputs/");
    expect(rendered).toContain("data/");
    for (const forbidden of [
      "C:\\Users\\Someone",
      "D:\\projects",
      "/home/alice",
      "/Users/bob",
      "/root/",
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
    expect(summary.utf8Bytes).toBe(utf8(rendered));
    expect(summary.utf8Bytes).toBeLessThanOrEqual(1_000_000);
  });

  it("omits personal path mentions even when a non-ASCII character or lowercase follows the directory name", () => {
    const contract = makeContract({
      boundaries: [
        { kind: "privacy", statement: "密钥在/home用户目录下" },
        { kind: "privacy", statement: "参考 /users/alice/ 即可" },
        { kind: "scope", statement: "使用 /homebrew 工具链" },
        { kind: "scope", statement: "只允许写入 ./outputs/ 目录" },
      ],
    });
    const summary = summarizeContract(contract, 1_000_000);
    expect(summary.boundaries).toEqual(["使用 /homebrew 工具链", "只允许写入 ./outputs/ 目录"]);
    expect(summary.omittedBoundaries).toBe(2);
    expect(summary.truncated).toBe(true);
    const rendered = renderedOf(summary);
    expect(rendered).not.toContain("/home用户");
    expect(rendered).not.toContain("/users/");
  });

  it("never copies sourceRefs excerpts, correction refs, preauthorizations, stop conditions, or assumptions", () => {
    const secret = "sk-1234abcdSECRET";
    const preauthorization = makePreauthorization();
    const contract = makeContract({
      title: "契约历史标题XYZ",
      sourceRefs: [
        { ref: "ref-1", type: "user_message", excerpt: `用户的密钥是 ${secret}，请勿外泄` },
        { ref: "ref-2", type: "external", excerpt: `restricted excerpt: ${secret}` },
      ],
      correctionRefs: ["CORRECTION-BODY-SECRET-STRING"],
      preauthorizations: [preauthorization],
      stopConditions: [
        { condition: "当交付物完成且核查清单完成时停止", isMet: false, evidenceRequired: true },
      ],
      assumptions: [
        { statement: "用户默认使用 UTC 时间", source: "user", confidence: 1, status: "active" },
      ],
      boundaries: [{ kind: "scope", statement: "只允许写入 ./outputs/ 目录" }],
    });
    const summary = summarizeContract(contract, 1_000_000);
    const rendered = renderedOf(summary);

    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain("CORRECTION-BODY-SECRET-STRING");
    expect(rendered).not.toContain(preauthorization.preauthorizationId);
    expect(rendered).not.toContain("当交付物完成且核查清单完成时停止");
    expect(rendered).not.toContain("用户默认使用 UTC 时间");
    expect(rendered).not.toContain("契约历史标题XYZ");
    // The summary contains exactly the three sections and nothing else.
    expect(summary.deliverables).toHaveLength(contract.deliverables.length);
    expect(summary.boundaries).toHaveLength(1);
  });

  it("is deterministic for the same inputs and never mutates the contract", () => {
    const contract = makeContract({
      boundaries: [
        { kind: "scope", statement: "只允许写入 ./outputs/ 目录" },
        { kind: "privacy", statement: "不得修改 C:\\Users\\Someone\\notes.txt" },
        { kind: "action", statement: "核查不得替代主任务 🚀📝" },
      ],
    });
    deepFreeze(contract);
    const before = JSON.stringify(contract);
    const budget =
      utf8(contract.objective.primary) +
      1 +
      utf8(contract.deliverables[0]?.description ?? "") +
      1 +
      utf8("只允许写入 ./outputs/ 目录");

    const first = summarizeContract(contract, budget);
    const second = summarizeContract(contract, budget);
    expect(second).toEqual(first);
    expect(JSON.stringify(contract)).toBe(before);
    expect(second.truncated).toBe(true);
  });

  it("never exceeds the byte budget across varied budgets", () => {
    const contract = makeContract({
      boundaries: [
        { kind: "scope", statement: "只允许写入 ./outputs/ 目录" },
        { kind: "privacy", statement: "不得修改 C:\\Users\\Someone\\notes.txt" },
        { kind: "action", statement: "核查不得替代主任务 🚀📝" },
      ],
    });
    for (const budget of [0, 1, 5, 20, 50, 100, 10_000]) {
      const summary = summarizeContract(contract, budget);
      const rendered = renderedOf(summary);
      expect(summary.utf8Bytes).toBe(utf8(rendered));
      expect(summary.utf8Bytes).toBeLessThanOrEqual(budget);
    }
  });

  it("rejects a negative or non-finite byte budget with validation_failed", () => {
    const contract = makeContract();
    expect(() => summarizeContract(contract, -1)).toThrowError(SestinaError);
    try {
      summarizeContract(contract, -1);
      expect.unreachable("a negative budget must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SestinaError);
      expect((error as SestinaError).code).toBe(SestinaErrorCode.validation_failed);
    }
    expect(() => summarizeContract(contract, Number.NaN)).toThrowError(SestinaError);
    expect(() => summarizeContract(contract, Number.POSITIVE_INFINITY)).toThrowError(SestinaError);
  });
});
