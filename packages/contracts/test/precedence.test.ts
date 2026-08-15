import { describe, it, expect } from "vitest";
import {
  CONTRACT_SOURCE_TIER_PRECEDENCE,
  ContractTemplateSchema,
  isSestinaError,
  SestinaErrorCode,
  sourceTypeToTier,
  type Boundary,
  type ContractPatchProposal,
  type ContractTemplate,
  type TaskContract,
} from "@sestina/schema";
import {
  compileInitialContract,
  type CompileContractInput,
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

// ── Helpers ──

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

const FIXED_IDS = {
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
    operations: [{ op: "add_boundary", boundary: extractorBoundary() }],
    sourceTier: "inferred",
    owner: "inferred",
    sourceRefs: [],
    ambiguities: [],
    createdAt: contract.createdAt,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Tier constants
// ══════════════════════════════════════════════════════════════════════

describe("CONTRACT_SOURCE_TIER_PRECEDENCE", () => {
  it("is exactly the frozen seven-tier order", () => {
    expect(CONTRACT_SOURCE_TIER_PRECEDENCE).toEqual([
      "system_safety",
      "user_directive",
      "confirmed_correction",
      "project_rule",
      "user_default",
      "template",
      "inferred",
    ]);
    expect(CONTRACT_SOURCE_TIER_PRECEDENCE).toHaveLength(7);
  });
});

describe("sourceTypeToTier", () => {
  it("maps every source type to its tier and corrections to confirmed_correction", () => {
    expect(sourceTypeToTier("correction")).toBe("confirmed_correction");
    expect(sourceTypeToTier("system_safety")).toBe("system_safety");
    expect(sourceTypeToTier("user_directive")).toBe("user_directive");
    expect(sourceTypeToTier("project_rule")).toBe("project_rule");
    expect(sourceTypeToTier("user_default")).toBe("user_default");
    expect(sourceTypeToTier("template")).toBe("template");
    expect(sourceTypeToTier("inferred")).toBe("inferred");
  });

  it("returns undefined for unknown source types", () => {
    expect(sourceTypeToTier("gossip")).toBeUndefined();
    expect(sourceTypeToTier("")).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// User facts beat template defaults
// ══════════════════════════════════════════════════════════════════════

describe("user facts vs template defaults", () => {
  it("user explicit budget beats the template budget in compile", () => {
    expect(RESEARCH_TEMPLATE.defaults.budgets.maxToolCallsPerTask).toBe(500);
    const contract = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    expect(contract.budgets.maxToolCallsPerTask).toBe(100);
  });

  it("user 不要 becomes a hard boundary while templates can never produce hard", () => {
    const contract = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    const noModify = contract.boundaries.find((b) => b.statement.includes("不要修改"));
    expect(noModify?.severity).toBe("hard");
    expect(noModify?.overridable).toBe(false);
    expect(noModify?.owner).toBe("user");
    const templateBoundaries = contract.boundaries.filter(
      (b) => b.source.type === "template",
    );
    expect(templateBoundaries.length).toBeGreaterThan(0);
    for (const boundary of templateBoundaries) {
      expect(boundary.severity).not.toBe("hard");
      expect(boundary.overridable).toBe(true);
      expect(boundary.owner).toBe("project");
    }
  });

  it("user directive tier outranks template tier", () => {
    expect(
      CONTRACT_SOURCE_TIER_PRECEDENCE.indexOf("user_directive"),
    ).toBeLessThan(CONTRACT_SOURCE_TIER_PRECEDENCE.indexOf("template"));
    const contract = compileInitialContract(researchInput(), { ids: FIXED_IDS });
    const firstTemplate = contract.boundaries.findIndex(
      (b) => b.source.type === "template",
    );
    const lastUserDirective = contract.boundaries
      .map((b, i) => ({ boundary: b, i }))
      .filter(({ boundary }) => boundary.source.type === "user_directive")
      .map(({ i }) => i)
      .reduce((max, i) => Math.max(max, i), -1);
    expect(lastUserDirective).toBeGreaterThanOrEqual(0);
    expect(lastUserDirective).toBeLessThan(firstTemplate);
  });

  it("every built-in template parses and stays soft/open with overridable boundaries", () => {
    const templates: [string, ContractTemplate][] = [
      ["research", RESEARCH_TEMPLATE],
      ["strategy", STRATEGY_TEMPLATE],
      ["software", SOFTWARE_TEMPLATE],
    ];
    for (const [kind, template] of templates) {
      const parsed = ContractTemplateSchema.parse(template);
      expect(parsed.kind).toBe(kind);
      for (const boundary of parsed.defaults.boundaries ?? []) {
        expect(boundary.severity).not.toBe("hard");
        expect(boundary.overridable).toBe(true);
        expect(boundary.source.type).toBe("template");
        expect(boundary.owner).toBe("project");
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Extractor proposals stay inferred and overridable
// ══════════════════════════════════════════════════════════════════════

describe("extractor proposals stay inferred and overridable", () => {
  const baseContract = () => compileInitialContract(minimalInput(), { ids: FIXED_IDS });

  it("accepts a valid inferred proposal and returns it unchanged", () => {
    const contract = baseContract();
    const proposal = validProposal(contract);
    const result = runSemanticExtractor(fakeExtractor(proposal), {
      contract,
      sourceText: minimalFixture.userPrompt,
      now: minimalFixture.now,
    });
    expect(result).toEqual(proposal);
    expect(result?.sourceTier).toBe("inferred");
    expect(result?.owner).toBe("inferred");
  });

  it("rejects proposals claiming a non-inferred tier", () => {
    const contract = baseContract();
    for (const sourceTier of ["user_directive", "template", "confirmed_correction", "system_safety"] as const) {
      expectSestinaCode(
        () =>
          runSemanticExtractor(
            fakeExtractor(validProposal(contract, { sourceTier })),
            { contract, sourceText: "", now: minimalFixture.now },
          ),
        SestinaErrorCode.validation_failed,
      );
    }
  });

  it("rejects hard and non-overridable boundaries from inferred extractors", () => {
    const contract = baseContract();
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(
            validProposal(contract, {
              operations: [
                { op: "add_boundary", boundary: extractorBoundary({ severity: "hard" }) },
              ],
            }),
          ),
          { contract, sourceText: "", now: minimalFixture.now },
        ),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () =>
        runSemanticExtractor(
          fakeExtractor(
            validProposal(contract, {
              operations: [
                {
                  op: "add_boundary",
                  boundary: extractorBoundary({ overridable: false }),
                },
              ],
            }),
          ),
          { contract, sourceText: "", now: minimalFixture.now },
        ),
      SestinaErrorCode.validation_failed,
    );
  });

  it("never applies extractor proposals to the contract during compile", () => {
    const without = compileInitialContract(minimalInput(), { ids: FIXED_IDS });
    const withExtractor = compileInitialContract(minimalInput(), {
      ids: FIXED_IDS,
      semanticExtractor: fakeExtractor(validProposal(without)),
    });
    expect(withExtractor.boundaries).toEqual(without.boundaries);
    expect(withExtractor.deliverables).toEqual(without.deliverables);
    expect(withExtractor.stopConditions).toEqual(without.stopConditions);
  });
});
