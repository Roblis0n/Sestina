import { describe, it, expect } from "vitest";
import {
  ContractTemplateSchema,
  isSestinaError,
  SestinaError,
  SestinaErrorCode,
  sourceSpanExtract,
  TaskContractSchema,
  type Boundary,
  type ContractPatchProposal,
  type ContractTemplate,
  type MaterialAmbiguity,
  type TaskContract,
} from "@sestina/schema";
import {
  compileContractDetailed,
  compileInitialContract,
  type CompileContractInput,
  type CompilerPorts,
} from "../src/compiler.js";
import {
  runSemanticExtractor,
  type ContractSemanticExtractor,
} from "../src/extractor-port.js";
import { RESEARCH_TEMPLATE } from "../src/templates/research.js";
import { STRATEGY_TEMPLATE } from "../src/templates/strategy.js";
import { SOFTWARE_TEMPLATE } from "../src/templates/software.js";
import { loadContractFixture } from "./fixtures.js";

const researchFixture = loadContractFixture("research-prompt-audit-limit.json");
const minimalFixture = loadContractFixture("strategy-prompt-minimal.json");

// ── Fixture-backed inputs ──

function researchInput(): CompileContractInput {
  return {
    projectId: researchFixture.projectId,
    taskId: researchFixture.taskId,
    title: researchFixture.title,
    userPrompt: researchFixture.userPrompt,
    userExcerpts: researchFixture.userExcerpts,
    templateId: researchFixture.templateId,
    now: researchFixture.now,
  };
}

function minimalInput(): CompileContractInput {
  return {
    projectId: minimalFixture.projectId,
    taskId: minimalFixture.taskId,
    title: minimalFixture.title,
    userPrompt: minimalFixture.userPrompt,
    userExcerpts: minimalFixture.userExcerpts,
    templateId: minimalFixture.templateId,
    now: minimalFixture.now,
  };
}

function makeInput(overrides: Partial<CompileContractInput> = {}): CompileContractInput {
  return {
    projectId: "QCK8734P493E1A2692YKPAS8B4",
    taskId: "KE568A1SQ91VX3ANPW9PPW58E4",
    title: "测试任务",
    userPrompt: "请完成分析。",
    now: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

// ── Deterministic ports (the determinism seam) ──

const FIXED_IDS: CompilerPorts["ids"] = {
  contractId: () => "AAAAAAAAAAAAAAAAAAAAAAAAAA",
  deliverableId: () => "BBBBBBBBBBBBBBBBBBBBBBBBBB",
  boundaryId: () => "CCCCCCCCCCCCCCCCCCCCCCCCCC",
};

function expectSestinaCode(run: () => unknown, code: SestinaErrorCode): void {
  try {
    run();
  } catch (err) {
    if (isSestinaError(err) && err.code === code) return;
    throw new Error(`expected SestinaError(${code}), got: ${String(err)}`, { cause: err });
  }
  throw new Error(`expected SestinaError(${code}), nothing was thrown`);
}

// ── Fake extractor seam ──

function fakeExtractor(
  result: ContractPatchProposal | undefined | Error,
): ContractSemanticExtractor {
  return {
    extractorId: "fake-extractor",
    propose: () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function extractorBoundary(overrides: Partial<Boundary> = {}): Boundary {
  return {
    boundaryId: "EXTRACTORBOUNDARY000000000000",
    kind: "process",
    severity: "soft",
    statement: "建议先阅读现有文档再动手",
    source: { type: "inferred", confidence: 0.5 },
    owner: "inferred",
    overridable: true,
    appliesTo: {},
    confidence: 0.5,
    status: "active",
    validFrom: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function validProposal(
  contract: TaskContract,
  overrides: Partial<ContractPatchProposal> = {},
): ContractPatchProposal {
  return {
    schemaVersion: "1.0.0",
    proposalId: "PPPPPPPPPPPPPPPPPPPPPPPPPP",
    contractId: contract.contractId,
    taskId: contract.taskId,
    expectedVersion: contract.version,
    operations: [
      {
        op: "add_boundary",
        boundary: extractorBoundary(),
      },
    ],
    sourceTier: "inferred",
    owner: "inferred",
    sourceRefs: [],
    ambiguities: [],
    createdAt: contract.createdAt,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// compileInitialContract — fixture fidelity (docs/22 Step 1 assertions)
// ══════════════════════════════════════════════════════════════════════

describe("compileInitialContract (research-prompt-audit-limit fixture)", () => {
  it("keeps the main deliverable primary while limiting a necessary risk check", () => {
    const contract = compileInitialContract(researchInput());
    expect(contract.objective.primary).toContain("完成主题分析");
    const riskCheckBoundary = contract.boundaries.find((b) =>
      b.statement.includes("核查不得替代主任务"),
    );
    expect(riskCheckBoundary).toBeDefined();
    expect(riskCheckBoundary?.severity).toBe("soft");
    expect(riskCheckBoundary?.owner).toBe("user");
  });

  it("produces a version-1 contract that re-parses via TaskContractSchema", () => {
    const contract = compileInitialContract(researchInput());
    const reparsed = TaskContractSchema.parse(contract);
    expect(reparsed.version).toBe(1);
    expect(reparsed.schemaVersion).toBe("1.0.0");
    expect(reparsed.status).toBe("draft");
    expect(reparsed.createdAt).toBe(researchFixture.now);
    expect(reparsed.updatedAt).toBe(researchFixture.now);
    expect(reparsed.contractId).toBe(contract.contractId);
  });

  it("extracts numbered deliverables verbatim with zero fabricated acceptance criteria", () => {
    const contract = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    expect(contract.deliverables).toHaveLength(2);
    expect(contract.deliverables[0]?.description).toBe("主题分析报告（需包含数据来源）");
    expect(contract.deliverables[1]?.description).toBe("风险核查清单");
    for (const deliverable of contract.deliverables) {
      expect(deliverable.acceptanceChecks).toEqual([]);
      expect(deliverable.required).toBe(true);
      expect(deliverable.status).toBe("not_started");
      expect(deliverable.evidenceRefs).toEqual([]);
    }
    expect(contract.deliverables.map((d) => d.deliverableId)).toEqual([
      "BBBBBBBBBBBBBBBBBBBBBBBBBB",
      "BBBBBBBBBBBBBBBBBBBBBBBBBB",
    ]);
  });

  it("classifies 不要 and 只允许 lines as hard non-overridable user boundaries", () => {
    const contract = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    const noModify = contract.boundaries.find((b) => b.statement.includes("不要修改"));
    expect(noModify).toBeDefined();
    expect(noModify).toMatchObject({
      severity: "hard",
      overridable: false,
      owner: "user",
      kind: "action",
      source: { type: "user_directive", confidence: 1 },
      confidence: 1,
      status: "active",
    });
    const onlyOutputs = contract.boundaries.find((b) => b.statement.includes("只允许"));
    expect(onlyOutputs).toBeDefined();
    expect(onlyOutputs).toMatchObject({
      severity: "hard",
      overridable: false,
      owner: "user",
      kind: "scope",
      source: { type: "user_directive", confidence: 1 },
    });
    expect(onlyOutputs?.appliesTo.paths).toEqual(["./outputs/"]);
  });

  it("classifies 必须 directives as soft overridable user boundaries", () => {
    const contract = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    const musts = contract.boundaries.filter(
      (b) => b.source.type === "user_directive" && b.severity === "soft",
    );
    expect(musts.map((b) => b.statement)).toEqual([
      "必须先完成主题分析，再开始风险核查",
      "风险核查不得替代主任务",
    ]);
    expect(musts.map((b) => b.kind)).toEqual(["process", "objective"]);
    for (const boundary of musts) {
      expect(boundary.overridable).toBe(true);
      expect(boundary.owner).toBe("user");
      expect(boundary.source.confidence).toBe(1);
    }
  });

  it("every explicit boundary source span round-trips to its statement", () => {
    const contract = compileInitialContract(researchInput());
    const userBoundaries = contract.boundaries.filter(
      (b) => b.source.type === "user_directive",
    );
    expect(userBoundaries.length).toBeGreaterThanOrEqual(4);
    for (const boundary of userBoundaries) {
      const span = boundary.source.sourceSpan;
      if (span === undefined) {
        throw new Error("expected every user boundary to carry a source span");
      }
      expect(sourceSpanExtract(researchFixture.userPrompt, span)).toBe(boundary.statement);
    }
  });

  it("records the explicit budget, deadline and stop condition without fabrication", () => {
    const contract = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    expect(contract.budgets).toEqual({ maxToolCallsPerTask: 100 });

    const deadline = contract.scope.in.find((s) => s.appliesTo.timeRange !== undefined);
    expect(deadline).toBeDefined();
    expect(deadline?.statement).toBe("截止日期：2026-09-01");
    expect(deadline?.appliesTo.timeRange).toEqual({ end: "2026-09-01T00:00:00.000Z" });
    expect(deadline?.source).toBe("user_directive");
    expect(deadline?.confidence).toBe(1);

    expect(contract.stopConditions).toHaveLength(1);
    expect(contract.stopConditions[0]).toEqual({
      condition: "当交付物 1 完成且风险核查清单完成时停止。",
      isMet: false,
      evidenceRequired: false,
    });
    expect(contract.scope.out).toEqual([]);
  });

  it("the deadline scope item carries a source span that round-trips to its statement", () => {
    const contract = compileInitialContract(researchInput());
    const deadline = contract.scope.in.find((s) => s.appliesTo.timeRange !== undefined);
    expect(deadline?.sourceSpan).toBeDefined();
    if (deadline?.sourceSpan === undefined) {
      throw new Error("expected the deadline scope item to carry a source span");
    }
    expect(sourceSpanExtract(researchFixture.userPrompt, deadline.sourceSpan)).toBe(
      "截止日期：2026-09-01",
    );
  });

  it("preserves the matched budget directive line verbatim as a sourceRef", () => {
    const contract = compileInitialContract(researchInput());
    const budgetRefs = contract.sourceRefs.filter((r) => r.ref.startsWith("budget-directive"));
    expect(budgetRefs).toHaveLength(1);
    expect(budgetRefs[0]?.type).toBe("user_message");
    expect(budgetRefs[0]?.excerpt).toBe("预算：最多 100 次工具调用");
  });

  it("leaves undeclared fields absent instead of inventing them", () => {
    const contract = compileInitialContract(researchInput());
    expect(contract.objective.rationale).toBeUndefined();
    expect(contract.objective.successSignal).toBeUndefined();
    expect(contract.objective.priority).toBe("normal");
    expect(contract.correctionRefs).toEqual([]);
    expect(contract.preauthorizations).toBeUndefined();
  });

  it("merges template defaults below user facts", () => {
    const contract = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    // The research template carries a 500-call budget default; the user's
    // explicit 100 wins.
    expect(contract.budgets.maxToolCallsPerTask).toBe(100);
    // Template-provided boundary stays soft, overridable and template-sourced.
    const templateBoundaries = contract.boundaries.filter(
      (b) => b.source.type === "template",
    );
    expect(templateBoundaries.length).toBeGreaterThanOrEqual(1);
    for (const boundary of templateBoundaries) {
      expect(boundary.severity).not.toBe("hard");
      expect(boundary.overridable).toBe(true);
      expect(boundary.owner).toBe("project");
    }
    // User directives come first, template defaults last.
    const firstUser = contract.boundaries.findIndex((b) => b.source.type !== "user_directive");
    expect(firstUser).toBeGreaterThanOrEqual(4);
    expect(contract.evidencePolicy).toEqual(RESEARCH_TEMPLATE.defaults.evidencePolicy);
    expect(contract.assumptions).toEqual(RESEARCH_TEMPLATE.defaults.assumptions);
  });

  it("reports schema_valid_only and honest notes when no extractor runs", () => {
    const contract = compileInitialContract(researchInput());
    expect(contract.semanticCompleteness).toEqual({
      semanticExtractorRan: false,
      completeness: "schema_valid_only",
      unknownFields: [],
      notes: "Provider 未运行、语义可能不完整",
    });
  });

  it("is deterministic for identical input and identical ports", () => {
    const first = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    const second = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    expect(second).toEqual(first);
  });

  it("defaults identifiers to valid ULIDs and honors the ids port", () => {
    const defaulted = compileInitialContract(researchInput());
    expect(defaulted.contractId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    for (const deliverable of defaulted.deliverables) {
      expect(deliverable.deliverableId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
    const overridden = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    expect(overridden.contractId).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("preserves userExcerpts as user_message sourceRefs", () => {
    const contract = compileInitialContract(
      makeInput({
        userPrompt: "请完成分析。",
        userExcerpts: ["关于数据来源的补充说明"],
      }),
    );
    expect(contract.sourceRefs).toEqual([
      { ref: "user-excerpt-0", type: "user_message", excerpt: "关于数据来源的补充说明" },
    ]);
  });

  it("rejects unknown template ids and invalid inputs with validation_failed", () => {
    expectSestinaCode(
      () => compileInitialContract({ ...researchInput(), templateId: "sestina/nonexistent" }),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () => compileInitialContract({ ...researchInput(), now: "not-a-timestamp" }),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () => compileInitialContract({ ...researchInput(), projectId: "bad-id" }),
      SestinaErrorCode.validation_failed,
    );
  });

  it("escalates priority only on explicit 必须 escalation markers", () => {
    const escalated = compileInitialContract(
      makeInput({
        userPrompt: "请完成主题分析。\n\n必须：\n- 必须尽快完成分析",
      }),
    );
    expect(escalated.objective.priority).toBe("high");
    const critical = compileInitialContract(
      makeInput({
        userPrompt: "请完成主题分析。\n\n必须：\n- 这是最高优先级任务",
      }),
    );
    expect(critical.objective.priority).toBe("critical");
    const ordinary = compileInitialContract(researchInput());
    expect(ordinary.objective.priority).toBe("normal");
  });

  it("extracts rationale and success signal only when explicitly stated", () => {
    const contract = compileInitialContract(
      makeInput({
        userPrompt:
          "请完成主题分析。\n\n理由：为了评估合同编译方案\n成功标准：产出一份可评审的报告",
      }),
    );
    expect(contract.objective.rationale).toBe("为了评估合同编译方案");
    expect(contract.objective.successSignal).toBe("产出一份可评审的报告");
    const without = compileInitialContract(researchInput());
    expect(without.objective.rationale).toBeUndefined();
    expect(without.objective.successSignal).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// Zero-fabrication and honesty
// ══════════════════════════════════════════════════════════════════════

describe("zero fabrication (strategy-prompt-minimal fixture)", () => {
  it("yields no fabricated deliverables, stop conditions or user boundaries", () => {
    const contract = compileInitialContract(minimalInput(), { ids: FIXED_IDS });
    expect(contract.deliverables).toEqual([]);
    expect(contract.stopConditions).toEqual([]);
    expect(contract.scope.in).toEqual([]);
    expect(contract.scope.out).toEqual([]);
    expect(contract.budgets).toEqual({});
    expect(contract.boundaries.every((b) => b.source.type === "template")).toBe(true);
    for (const boundary of contract.boundaries) {
      expect(boundary.severity).not.toBe("hard");
      expect(boundary.overridable).toBe(true);
      expect(boundary.owner).toBe("project");
    }
    expect(contract.objective.primary).toBe(
      "帮我梳理一下这个项目的技术路线，看看接下来怎么走比较好。",
    );
  });

  it("skips unparseable section content and documents it in the notes", () => {
    const contract = compileInitialContract(
      makeInput({
        userPrompt: "请完成报告。\n\n交付物：\n1. 报告\n这段文本无法解析",
      }),
    );
    expect(contract.deliverables.map((d) => d.description)).toEqual(["报告"]);
    expect(contract.semanticCompleteness?.notes).toContain("跳过无法解析的内容 1 处");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Built-in templates
// ══════════════════════════════════════════════════════════════════════

describe("built-in contract templates", () => {
  const templates: [string, ContractTemplate][] = [
    ["research", RESEARCH_TEMPLATE],
    ["strategy", STRATEGY_TEMPLATE],
    ["software", SOFTWARE_TEMPLATE],
  ];

  it("has the frozen template ids", () => {
    expect(RESEARCH_TEMPLATE.templateId).toBe("sestina/research");
    expect(STRATEGY_TEMPLATE.templateId).toBe("sestina/strategy");
    expect(SOFTWARE_TEMPLATE.templateId).toBe("sestina/software");
  });

  it.each(templates)("%s template parses via ContractTemplateSchema", (_kind, template) => {
    expect(() => ContractTemplateSchema.parse(template)).not.toThrow();
    const parsed = ContractTemplateSchema.parse(template);
    expect(parsed.templateId).toBe(template.templateId);
  });

  it.each(templates)("%s template boundaries are never hard", (_kind, template) => {
    for (const boundary of template.defaults.boundaries ?? []) {
      expect(boundary.severity).not.toBe("hard");
      expect(boundary.overridable).toBe(true);
      expect(boundary.source.type).toBe("template");
      expect(boundary.owner).toBe("project");
    }
  });

  it("rejects a template with a hard boundary via the schema refine", () => {
    const invalid: ContractTemplate = {
      ...structuredClone(STRATEGY_TEMPLATE),
      defaults: {
        ...structuredClone(STRATEGY_TEMPLATE.defaults),
        boundaries: [
          {
            boundaryId: "tmpl-hard",
            kind: "action",
            severity: "hard",
            statement: "禁止一切操作",
            source: { type: "template", confidence: 1 },
            owner: "project",
            overridable: false,
            appliesTo: {},
            confidence: 1,
            status: "active",
            validFrom: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    };
    expect(() => ContractTemplateSchema.parse(invalid)).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════
// compileContractDetailed — high-impact vs methodological ambiguity
// ══════════════════════════════════════════════════════════════════════

describe("compileContractDetailed", () => {
  it("matches compileInitialContract and reports no ambiguities for the fixture", () => {
    const detailed = compileContractDetailed(researchInput(), { ids: FIXED_IDS });
    const initial = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    expect(detailed.contract).toEqual(initial);
    expect(detailed.ambiguities).toEqual([]);
    expect(detailed.assumptions).toEqual([]);
  });

  it("surfaces conflicting 必须 directives as decision-required MaterialAmbiguity", () => {
    const input = makeInput({
      userPrompt:
        "请完成主题分析。\n\n必须：\n- 必须先完成主题分析，再开始风险核查\n- 必须先完成风险核查，再开始主题分析",
    });
    const detailed = compileContractDetailed(input, { ids: FIXED_IDS });
    expect(detailed.ambiguities).toHaveLength(1);
    const ambiguity = detailed.ambiguities[0];
    expect(ambiguity?.kind).toBe("conflicting_directives");
    expect(ambiguity?.decisionRequired).toBe(true);
    expect(ambiguity?.sourceSpans).toHaveLength(2);
    expect(
      ambiguity?.sourceSpans.map((span) => sourceSpanExtract(input.userPrompt, span)),
    ).toEqual(["必须先完成主题分析，再开始风险核查", "必须先完成风险核查，再开始主题分析"]);
    // The ambiguity also lands in the contract as an open, inferred boundary.
    const open = detailed.contract.boundaries.find((b) => b.severity === "open");
    expect(open).toBeDefined();
    expect(open).toMatchObject({ owner: "inferred", overridable: true, kind: "objective" });
    expect(open?.source.type).toBe("inferred");
    expect(detailed.contract.sourceRefs.some((r) => r.type === "user_message" && r.excerpt)).toBe(
      true,
    );
    // compileInitialContract carries the same open boundary.
    const initial = compileInitialContract(input, { ids: FIXED_IDS });
    expect(initial.boundaries.some((b) => b.severity === "open")).toBe(true);
  });

  it("detects conflicting named methods as conflicting_directives", () => {
    const input = makeInput({
      userPrompt: "请完成脚本。\n\n必须：\n- 必须使用 Python 编写脚本\n- 必须使用 Rust 编写脚本",
    });
    const detailed = compileContractDetailed(input, { ids: FIXED_IDS });
    expect(detailed.ambiguities.map((a) => a.kind)).toContain("conflicting_directives");
  });

  it("flags stop conditions referencing undeclared deliverables", () => {
    const input = makeInput({
      userPrompt: "请完成报告。\n\n交付物：\n1. 报告\n\n停止条件：当交付物 3 完成时停止。",
    });
    const detailed = compileContractDetailed(input, { ids: FIXED_IDS });
    expect(detailed.ambiguities).toHaveLength(1);
    expect(detailed.ambiguities[0]?.kind).toBe("completion_criteria_unclear");
    expect(detailed.ambiguities[0]?.decisionRequired).toBe(true);
    const open = detailed.contract.boundaries.find((b) => b.severity === "open");
    expect(open?.kind).toBe("completion");
  });

  it("treats methodological gaps as assumptions, not MaterialAmbiguity", () => {
    const input = makeInput({
      userPrompt: "请完成校验。\n\n必须：\n- 必须对数据进行完整性校验，具体方式由你决定",
    });
    const detailed = compileContractDetailed(input, { ids: FIXED_IDS });
    expect(detailed.ambiguities).toEqual([]);
    expect(detailed.assumptions).toHaveLength(1);
    expect(detailed.assumptions[0]).toContain("完整性校验");
    expect(detailed.contract.boundaries.some((b) => b.severity === "open")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Semantic extractor integration during compile
// ══════════════════════════════════════════════════════════════════════

describe("semantic extractor integration in compile", () => {
  it("reports provider_assisted but never applies extractor proposals", () => {
    const contract = compileInitialContract(minimalInput(), { ids: FIXED_IDS });
    const proposal = validProposal(contract);
    const compiled = compileInitialContract(minimalInput(), {
      ids: FIXED_IDS,
      semanticExtractor: fakeExtractor(proposal),
    });
    expect(compiled.semanticCompleteness).toEqual({
      semanticExtractorRan: true,
      completeness: "provider_assisted",
      unknownFields: [],
      notes: "",
    });
    // The proposal's add_boundary op must not appear anywhere in the contract.
    expect(
      compiled.boundaries.some((b) => b.statement.includes("建议先阅读现有文档")),
    ).toBe(false);
    expect(compiled.boundaries).toEqual(contract.boundaries);
  });

  it("surfaces decision-required extractor ambiguities in the detailed result only", () => {
    const base = compileInitialContract(minimalInput(), { ids: FIXED_IDS });
    const material: MaterialAmbiguity = {
      ambiguityId: "EXTRAMBG000000000000000000",
      kind: "scope_boundary_unclear",
      description: "输出目录的边界需要用户确认",
      sourceSpans: [{ start: 0, end: 5 }],
      decisionRequired: true,
    };
    const proposal = validProposal(base, { ambiguities: [material] });
    const detailed = compileContractDetailed(minimalInput(), {
      ids: FIXED_IDS,
      semanticExtractor: fakeExtractor(proposal),
    });
    expect(detailed.ambiguities).toEqual([material]);
    expect(detailed.contract.boundaries.some((b) => b.severity === "open")).toBe(false);
    expect(detailed.contract.boundaries).toEqual(base.boundaries);
  });

  it("propagates invalid extractor output instead of swallowing it", () => {
    const base = compileInitialContract(minimalInput(), { ids: FIXED_IDS });
    const bad = validProposal(base, { contractId: "ZZZZZZZZZZZZZZZZZZZZZZZZZZ" });
    expectSestinaCode(
      () =>
        compileInitialContract(minimalInput(), {
          ids: FIXED_IDS,
          semanticExtractor: fakeExtractor(bad),
        }),
      SestinaErrorCode.validation_failed,
    );
  });

  it("propagates input-size limit violations from the extractor", () => {
    const base = compileInitialContract(minimalInput(), { ids: FIXED_IDS });
    const proposal = validProposal(base);
    expectSestinaCode(
      () =>
        compileInitialContract(minimalInput(), {
          ids: FIXED_IDS,
          semanticExtractor: fakeExtractor(proposal),
          maxExtractorInputChars: 10,
        }),
      SestinaErrorCode.limit_exceeded,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// runSemanticExtractor validation fence
// ══════════════════════════════════════════════════════════════════════

describe("runSemanticExtractor", () => {
  const baseContract = () => compileInitialContract(minimalInput(), { ids: FIXED_IDS });

  it("returns the proposal and leaves the context contract untouched", () => {
    const contract = baseContract();
    const before = structuredClone(contract);
    const proposal = validProposal(contract);
    const result = runSemanticExtractor(fakeExtractor(proposal), {
      contract,
      sourceText: minimalFixture.userPrompt,
      now: minimalFixture.now,
    });
    expect(result).toEqual(proposal);
    expect(contract).toEqual(before);
  });

  it("treats an undefined extractor result as a legitimate no-proposal", () => {
    const contract = baseContract();
    expect(
      runSemanticExtractor(fakeExtractor(undefined), {
        contract,
        sourceText: minimalFixture.userPrompt,
        now: minimalFixture.now,
      }),
    ).toBeUndefined();
  });

  it("rejects schema-invalid output with validation_failed", () => {
    const contract = baseContract();
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(validProposal(contract, { operations: [] })),
          { contract, sourceText: "", now: minimalFixture.now },
        ),
      SestinaErrorCode.validation_failed,
    );
  });

  it("rejects contractId, taskId and version mismatches with validation_failed", () => {
    const contract = baseContract();
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(validProposal(contract, { contractId: "ZZZZZZZZZZZZZZZZZZZZZZZZZZ" })),
          { contract, sourceText: "", now: minimalFixture.now },
        ),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(validProposal(contract, { taskId: "ZZZZZZZZZZZZZZZZZZZZZZZZZZ" })),
          { contract, sourceText: "", now: minimalFixture.now },
        ),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(validProposal(contract, { expectedVersion: contract.version + 1 })),
          { contract, sourceText: "", now: minimalFixture.now },
        ),
      SestinaErrorCode.validation_failed,
    );
  });

  it("rejects proposals that claim any tier above inferred", () => {
    const contract = baseContract();
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(validProposal(contract, { sourceTier: "user_directive" })),
          { contract, sourceText: "", now: minimalFixture.now },
        ),
      SestinaErrorCode.validation_failed,
    );
    // inferred tier with non-inferred owner fails schema parsing outright.
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(
            validProposal(contract, {
              sourceTier: "inferred",
              owner: "user",
            }),
          ),
          { contract, sourceText: "", now: minimalFixture.now },
        ),
      SestinaErrorCode.validation_failed,
    );
  });

  it("rejects ops that create hard, non-overridable or authority boundaries", () => {
    const contract = baseContract();

    const hard = validProposal(contract, {
      operations: [
        { op: "add_boundary", boundary: extractorBoundary({ severity: "hard" }) },
      ],
    });
    expectSestinaCode(
      () =>
        runSemanticExtractor(fakeExtractor(hard), {
          contract,
          sourceText: "",
          now: minimalFixture.now,
        }),
      SestinaErrorCode.validation_failed,
    );

    const locked = validProposal(contract, {
      operations: [
        { op: "add_boundary", boundary: extractorBoundary({ overridable: false }) },
      ],
    });
    expectSestinaCode(
      () =>
        runSemanticExtractor(fakeExtractor(locked), {
          contract,
          sourceText: "",
          now: minimalFixture.now,
        }),
      SestinaErrorCode.validation_failed,
    );

    const authorityBoundary = validProposal(contract, {
      operations: [
        { op: "add_boundary", boundary: extractorBoundary({ kind: "authority" }) },
      ],
    });
    expectSestinaCode(
      () =>
        runSemanticExtractor(fakeExtractor(authorityBoundary), {
          contract,
          sourceText: "",
          now: minimalFixture.now,
        }),
      SestinaErrorCode.validation_failed,
    );

    const authorityPolicy = validProposal(contract, {
      operations: [
        {
          op: "set_field",
          path: { section: "authority", field: "executorCanSelfReview" },
          value: true,
        },
      ],
    });
    expectSestinaCode(
      () =>
        runSemanticExtractor(fakeExtractor(authorityPolicy), {
          contract,
          sourceText: "",
          now: minimalFixture.now,
        }),
      SestinaErrorCode.validation_failed,
    );
  });

  it("rejects inferred proposals that create preauthorizations", () => {
    const contract = baseContract();
    const preauthorizing = validProposal(contract, {
      operations: [
        {
          op: "add_preauthorization",
          preauthorization: {
            schemaVersion: "1.0.0",
            preauthorizationId: "PRECHECKS000000000000000000",
            projectId: "QCK8734P493E1A2692YKPAS8B4",
            taskId: contract.taskId,
            source: { host: "codex" },
            target: { host: "claude_code" },
            deliverableIds: [],
            pathScope: [],
            actionCategories: [],
            confirmedBy: { actor: "user", channel: "desktop", directUser: true },
            contractVersion: contract.version,
            status: "active",
            confirmedAt: minimalFixture.now,
          },
        },
      ],
    });
    expectSestinaCode(
      () =>
        runSemanticExtractor(fakeExtractor(preauthorizing), {
          contract,
          sourceText: "",
          now: minimalFixture.now,
        }),
      SestinaErrorCode.validation_failed,
    );
  });

  it("enforces input and output size limits with limit_exceeded", () => {
    const contract = baseContract();
    const proposal = validProposal(contract);
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(proposal),
          { contract, sourceText: "x".repeat(1001), now: minimalFixture.now },
          { maxInputChars: 1000 },
        ),
      SestinaErrorCode.limit_exceeded,
    );
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(proposal),
          { contract, sourceText: "", now: minimalFixture.now },
          { maxOutputBytes: 100 },
        ),
      SestinaErrorCode.limit_exceeded,
    );
  });

  it("propagates errors thrown by the extractor instead of swallowing them", () => {
    const contract = baseContract();
    const boom = new SestinaError(SestinaErrorCode.internal_error, "extractor exploded");
    let observed: unknown;
    try {
      runSemanticExtractor(fakeExtractor(boom), {
        contract,
        sourceText: "",
        now: minimalFixture.now,
      });
    } catch (err) {
      observed = err;
    }
    expect(observed).toBe(boom);
  });
});

// ── Review regression: fidelity-parser edge cases (Task 9 final review) ──

describe("fidelity parser edge cases", () => {
  it("extracts bare-bullet directives outside any section, with round-tripping spans", () => {
    const userPrompt = "请完成报告。\n- 必须用Python编写\n- 不要访问网络";
    const contract = compileInitialContract(
      makeInput({ userPrompt }),
      { ids: FIXED_IDS },
    );
    const must = contract.boundaries.find((b) => b.statement === "必须用Python编写");
    expect(must).toBeDefined();
    expect(must?.severity).toBe("soft");
    const prohibition = contract.boundaries.find((b) => b.statement === "不要访问网络");
    expect(prohibition).toBeDefined();
    expect(prohibition?.severity).toBe("hard");
    for (const boundary of [must, prohibition]) {
      if (!boundary?.source.sourceSpan) throw new Error("expected a source span");
      expect(sourceSpanExtract(userPrompt, boundary.source.sourceSpan)).toBe(
        boundary.statement,
      );
    }
  });

  it("counts marker-bearing prose outside sections as skipped instead of dropping it silently", () => {
    const input = makeInput({
      userPrompt: "请完成报告。\n完成后必须发邮件通知我",
    });
    const contract = compileInitialContract(input, { ids: FIXED_IDS });
    expect(contract.boundaries.filter((b) => b.owner === "user")).toHaveLength(0);
    expect(contract.semanticCompleteness?.notes).toContain("跳过无法解析的内容 1 处");
  });

  it("demotes prohibitions without safety sense to soft overridable boundaries", () => {
    const contract = compileInitialContract(
      makeInput({
        userPrompt: "请完成报告。\n不要：\n- 不要使用红色字体",
      }),
      { ids: FIXED_IDS },
    );
    const boundary = contract.boundaries.find((b) => b.statement === "不要使用红色字体");
    expect(boundary).toBeDefined();
    expect(boundary?.severity).toBe("soft");
    expect(boundary?.overridable).toBe(true);
  });

  it("preserves an explicit time of day in a deadline line", () => {
    const contract = compileInitialContract(
      makeInput({ userPrompt: "请完成报告。\n截止日期：2026-09-01 23:59" }),
      { ids: FIXED_IDS },
    );
    expect(contract.scope.in).toHaveLength(1);
    expect(contract.scope.in[0]?.appliesTo.timeRange?.end).toBe("2026-09-01T23:59:00.000Z");
  });

  it("skips a calendar-invalid deadline date instead of surfacing internal_error", () => {
    const contract = compileInitialContract(
      makeInput({ userPrompt: "请完成报告。\n截止日期：2026-02-30" }),
      { ids: FIXED_IDS },
    );
    expect(contract.scope.in).toHaveLength(0);
    expect(contract.semanticCompleteness?.notes).toContain("跳过无法解析的内容 1 处");
  });

  it("skips an oversized deadline line instead of surfacing internal_error", () => {
    const contract = compileInitialContract(
      makeInput({ userPrompt: `请完成报告。\n截止日期：2026-09-01 ${"长".repeat(2100)}` }),
      { ids: FIXED_IDS },
    );
    expect(contract.scope.in).toHaveLength(0);
    expect(contract.semanticCompleteness?.notes).toContain("跳过无法解析的内容 1 处");
  });

  it("records every count in a multi-count budget line under its own category", () => {
    const contract = compileInitialContract(
      makeInput({
        userPrompt: "请完成报告。\n预算：最多 100 次工具调用，最多 50 次 provider 调用",
      }),
      { ids: FIXED_IDS },
    );
    expect(contract.budgets.maxToolCallsPerTask).toBe(100);
    expect(contract.budgets.maxProviderCallsPerTask).toBe(50);
  });

  it("skips an ambiguous budget count instead of guessing its category", () => {
    const contract = compileInitialContract(
      makeInput({ userPrompt: "请完成报告。\n预算：最多 100 次调用" }),
      { ids: FIXED_IDS },
    );
    expect(contract.budgets.maxToolCallsPerTask).toBeUndefined();
    expect(contract.budgets.maxProviderCallsPerTask).toBeUndefined();
    expect(contract.semanticCompleteness?.notes).toContain("跳过无法解析的内容 1 处");
  });

  it("does not compile a directive bullet inside the deliverables section as a deliverable", () => {
    const contract = compileInitialContract(
      makeInput({
        userPrompt: "请完成报告。\n交付物：\n1. 报告\n- 必须包含数据来源",
      }),
      { ids: FIXED_IDS },
    );
    expect(contract.deliverables.map((d) => d.description)).toEqual(["报告"]);
    expect(contract.semanticCompleteness?.notes).toContain("跳过无法解析的内容 1 处");
  });

  it("never leaves a lone surrogate when clipping ambiguity text at a wide character", () => {
    const mustA = `使用甲方法编写${"a".repeat(492)}`;
    const mustB = `使用乙方法编写${"b".repeat(477)}📊${"c".repeat(2)}`;
    const contract = compileInitialContract(
      makeInput({
        userPrompt: `请完成报告。\n必须：${mustA}\n必须：${mustB}`,
      }),
      { ids: FIXED_IDS },
    );
    expect(contract.boundaries.some((b) => b.severity === "open")).toBe(true);
    const detailed = compileContractDetailed(
      makeInput({
        userPrompt: `请完成报告。\n必须：${mustA}\n必须：${mustB}`,
      }),
      { ids: FIXED_IDS },
    );
    const ambiguity = detailed.ambiguities.find(
      (a) => a.kind === "conflicting_directives",
    );
    expect(ambiguity).toBeDefined();
    if (!ambiguity) throw new Error("unreachable");
    expect(ambiguity.description.endsWith("…")).toBe(true);
    expect(ambiguity.description).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});
