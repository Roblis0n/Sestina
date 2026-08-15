import { describe, expect, it } from "vitest";
import {
  canActAsDirectUser,
  ContractPatchOperationSchema,
  ContractPatchProposalSchema,
  generateId,
  isSestinaError,
  SestinaError,
  SestinaErrorCode,
  TaskContractSchema,
  type ActorProvenance,
  type ContractPatchOperation,
  type ContractPatchProposal,
  type TaskContract,
} from "@sestina/schema";
import { applyContractPatch, proposeContractPatch } from "../src/patch.js";
import type { ContractSemanticExtractor } from "../src/extractor-port.js";

const DIRECT_USER: ActorProvenance = { actor: "user", channel: "desktop", directUser: true };
const PEER: ActorProvenance = { actor: "agent", channel: "host", directUser: false };

const ISO_BASE = "2026-08-14T00:00:00.000Z";
const ISO_PROPOSAL = "2026-08-15T00:00:00.000Z";

function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    schemaVersion: "1.0.0",
    contractId: generateId(),
    taskId: generateId(),
    version: 3,
    status: "active",
    title: "初始契约",
    objective: { primary: "完成审计", priority: "normal" },
    deliverables: [
      {
        deliverableId: "d1",
        description: "报告",
        acceptanceChecks: [],
        required: true,
        status: "not_started",
        evidenceRefs: [],
      },
    ],
    scope: { in: [], out: [] },
    boundaries: [],
    evidencePolicy: {
      requireSourceForClaims: false,
      minEvidenceLevel: "none",
      allowUserTestimony: true,
    },
    authority: {
      executorCanChooseMethods: false,
      executorCanProposeScope: false,
      executorCanSelfReview: false,
      overridesRequireUserConfirmation: false,
    },
    budgets: {},
    stopConditions: [],
    assumptions: [],
    correctionRefs: [],
    sourceRefs: [{ ref: "msg-1", type: "user_message" }],
    createdAt: ISO_BASE,
    updatedAt: ISO_BASE,
    ...overrides,
  };
}

function makeProposal(
  contract: TaskContract,
  operations: ContractPatchOperation[],
  overrides: Partial<ContractPatchProposal> = {},
): ContractPatchProposal {
  return {
    schemaVersion: "1.0.0",
    proposalId: generateId(),
    contractId: contract.contractId,
    taskId: contract.taskId,
    expectedVersion: contract.version,
    operations,
    sourceTier: "user_directive",
    owner: "user",
    sourceRefs: [],
    ambiguities: [],
    createdAt: ISO_PROPOSAL,
    ...overrides,
  };
}

const setTitleOp = (value: string): ContractPatchOperation => ({
  op: "set_field",
  path: { section: "title" },
  value,
});

const upsertDeliverableOp = (
  deliverableId: string,
  description: string,
): ContractPatchOperation => ({
  op: "upsert_deliverable",
  deliverable: {
    deliverableId,
    description,
    acceptanceChecks: [],
    required: true,
    status: "not_started",
    evidenceRefs: [],
  },
});

const addBoundaryOp = (boundaryId: string, statement: string): ContractPatchOperation => ({
  op: "add_boundary",
  boundary: {
    boundaryId,
    kind: "scope",
    severity: "soft",
    statement,
    source: { type: "user_directive", confidence: 1 },
    owner: "user",
    overridable: true,
    appliesTo: {},
    confidence: 1,
    status: "active",
    validFrom: ISO_BASE,
  },
});

function captureSestinaError(fn: () => void): SestinaError {
  try {
    fn();
  } catch (err) {
    if (isSestinaError(err)) return err;
    throw err;
  }
  throw new Error("expected a SestinaError to be thrown, but nothing was thrown");
}

describe("applyContractPatch versioning and identity", () => {
  it("rejects a stale expectedVersion with contract_version_mismatch", () => {
    const contract = makeContract();
    const proposal = makeProposal(contract, [setTitleOp("stale")], {
      expectedVersion: contract.version + 1,
    });
    const err = captureSestinaError(() => applyContractPatch(contract, proposal));
    expect(err.code).toBe(SestinaErrorCode.contract_version_mismatch);
    expect(err.details).toEqual({ actual: 3, expected: 4 });
  });

  it("rejects a proposal bound to a different contract identity with validation_failed", () => {
    const contract = makeContract();
    const other = makeContract();
    const proposal = makeProposal(other, [setTitleOp("wrong contract")]);
    const err = captureSestinaError(() => applyContractPatch(contract, proposal));
    expect(err.code).toBe(SestinaErrorCode.validation_failed);
  });

  it("freezes inputs, never mutates them, and returns a fresh +1 version object", () => {
    const contract = makeContract();
    const proposal = makeProposal(contract, [
      setTitleOp("新标题"),
      upsertDeliverableOp("d9", "核查清单"),
    ]);
    const contractBefore = JSON.stringify(contract);
    const proposalBefore = JSON.stringify(proposal);

    const result = applyContractPatch(contract, proposal);

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.objective)).toBe(true);
    expect(Object.isFrozen(contract.deliverables)).toBe(true);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(JSON.stringify(contract)).toBe(contractBefore);
    expect(JSON.stringify(proposal)).toBe(proposalBefore);
    expect(result).not.toBe(contract);
    expect(result.deliverables).not.toBe(contract.deliverables);
    expect(result.version).toBe(contract.version + 1);
    expect(result.title).toBe("新标题");
    expect(result.deliverables.map((d) => d.deliverableId)).toEqual(["d1", "d9"]);
  });

  it("stamps updatedAt from the proposal createdAt and preserves identity and history", () => {
    const contract = makeContract({ correctionRefs: ["c1"] });
    const proposal = makeProposal(contract, [setTitleOp("新的")], {
      createdAt: "2026-08-15T12:00:00.000Z",
      sourceRefs: [{ ref: "r1", type: "user_message" }],
    });
    const result = applyContractPatch(contract, proposal);
    expect(result.updatedAt).toBe("2026-08-15T12:00:00.000Z");
    expect(result.createdAt).toBe(contract.createdAt);
    expect(result.contractId).toBe(contract.contractId);
    expect(result.taskId).toBe(contract.taskId);
    expect(result.correctionRefs).toEqual(["c1"]);
    expect(result.sourceRefs).toEqual(contract.sourceRefs);
  });

  it("returns results that parse via TaskContractSchema and proposals that parse via ContractPatchProposalSchema", () => {
    const contract = makeContract();
    const proposal = makeProposal(contract, [
      setTitleOp("解析校验"),
      { op: "set_field", path: { section: "objective", field: "priority" }, value: "critical" },
    ]);
    expect(ContractPatchProposalSchema.safeParse(proposal).success).toBe(true);
    const result = applyContractPatch(contract, proposal);
    expect(TaskContractSchema.safeParse(result).success).toBe(true);
    expect(result.objective.priority).toBe("critical");
  });
});

describe("proposeContractPatch deterministic parser", () => {
  it("recognizes explicit budget directives as set_field ops on budgets.*", () => {
    const contract = makeContract();
    const proposal = proposeContractPatch({
      contract,
      instruction: "预算改为 100 次工具调用，最大 Provider 调用设为 30，最大裁决成本 5.5。",
      actor: DIRECT_USER,
      proposalId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
      createdAt: "2020-01-02T03:04:05.000Z",
    });
    expect(proposal.operations).toHaveLength(3);
    expect(proposal.schemaVersion).toBe("1.0.0");
    expect(proposal.proposalId).toBe("01JABCDEFGHJKMNPQRSTVWXYZ0");
    expect(proposal.expectedVersion).toBe(contract.version);
    expect(proposal.contractId).toBe(contract.contractId);
    expect(proposal.taskId).toBe(contract.taskId);
    expect(proposal.createdAt).toBe("2020-01-02T03:04:05.000Z");
    expect(proposal.sourceTier).toBe("user_directive");
    expect(proposal.owner).toBe("user");
    expect(proposal.sourceRefs).toEqual([]);
    expect(ContractPatchProposalSchema.safeParse(proposal).success).toBe(true);
    const result = applyContractPatch(contract, proposal);
    expect(result.budgets.maxToolCallsPerTask).toBe(100);
    expect(result.budgets.maxProviderCallsPerTask).toBe(30);
    expect(result.budgets.maxJudgmentCostPerTask).toBe(5.5);
  });

  it("recognizes title, priority, authority and evidencePolicy directives", () => {
    const contract = makeContract();
    const proposal = proposeContractPatch({
      contract,
      instruction:
        "标题改为 审计报告。优先级改为 high。executorCanSelfReview 改为 true。" +
        "requireSourceForClaims 设为 false。minEvidenceLevel 改为 excerpt。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(proposal.operations).toHaveLength(5);
    const result = applyContractPatch(contract, proposal);
    expect(result.title).toBe("审计报告");
    expect(result.objective.priority).toBe("high");
    expect(result.authority.executorCanSelfReview).toBe(true);
    expect(result.evidencePolicy.requireSourceForClaims).toBe(false);
    expect(result.evidencePolicy.minEvidenceLevel).toBe("excerpt");
  });

  it("applies set_field on every whitelisted section", () => {
    const contract = makeContract();
    const ops: ContractPatchOperation[] = [
      { op: "set_field", path: { section: "title" }, value: "T2" },
      { op: "set_field", path: { section: "objective", field: "primary" }, value: "P2" },
      { op: "set_field", path: { section: "objective", field: "rationale" }, value: "R" },
      { op: "set_field", path: { section: "objective", field: "priority" }, value: "critical" },
      { op: "set_field", path: { section: "objective", field: "successSignal" }, value: "S" },
      { op: "set_field", path: { section: "budgets", field: "maxToolCallsPerTask" }, value: 40 },
      { op: "set_field", path: { section: "budgets", field: "maxProviderCallsPerTask" }, value: 8 },
      { op: "set_field", path: { section: "budgets", field: "maxJudgmentCostPerTask" }, value: 2.5 },
      { op: "set_field", path: { section: "authority", field: "executorCanChooseMethods" }, value: true },
      { op: "set_field", path: { section: "authority", field: "executorCanProposeScope" }, value: true },
      { op: "set_field", path: { section: "authority", field: "executorCanSelfReview" }, value: true },
      { op: "set_field", path: { section: "authority", field: "overridesRequireUserConfirmation" }, value: true },
      { op: "set_field", path: { section: "evidencePolicy", field: "requireSourceForClaims" }, value: true },
      { op: "set_field", path: { section: "evidencePolicy", field: "minEvidenceLevel" }, value: "hash" },
      { op: "set_field", path: { section: "evidencePolicy", field: "allowUserTestimony" }, value: false },
    ];
    const result = applyContractPatch(contract, makeProposal(contract, ops));
    expect(result.title).toBe("T2");
    expect(result.objective.primary).toBe("P2");
    expect(result.objective.rationale).toBe("R");
    expect(result.objective.priority).toBe("critical");
    expect(result.objective.successSignal).toBe("S");
    expect(result.budgets).toEqual({
      maxToolCallsPerTask: 40,
      maxProviderCallsPerTask: 8,
      maxJudgmentCostPerTask: 2.5,
    });
    expect(result.authority).toEqual({
      executorCanChooseMethods: true,
      executorCanProposeScope: true,
      executorCanSelfReview: true,
      overridesRequireUserConfirmation: true,
    });
    expect(result.evidencePolicy).toEqual({
      requireSourceForClaims: true,
      minEvidenceLevel: "hash",
      allowUserTestimony: false,
    });
  });

  it("adds and removes deliverables by description and by deliverableId", () => {
    const contract = makeContract();
    const proposal = proposeContractPatch({
      contract,
      instruction: "新增交付物：核查清单。删除交付物：报告。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(proposal.operations).toHaveLength(2);
    const result = applyContractPatch(contract, proposal);
    expect(result.deliverables).toHaveLength(1);
    expect(result.deliverables[0]?.description).toBe("核查清单");

    const idContract = makeContract();
    const idProposal = proposeContractPatch({
      contract: idContract,
      instruction: `删除交付物：${idContract.deliverables[0]?.deliverableId ?? ""}。`,
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    const idResult = applyContractPatch(idContract, idProposal);
    expect(idResult.deliverables).toHaveLength(0);
  });

  it("adds boundaries, stop conditions, assumptions and scope items from directives", () => {
    const contract = makeContract();
    const proposal = proposeContractPatch({
      contract,
      instruction:
        "新增边界：不要删除数据。新增停止条件：所有交付物完成。" +
        "新增假设：网络可用。新增范围：src/。新增范围外：data/。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(proposal.operations).toHaveLength(5);
    const result = applyContractPatch(contract, proposal);
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0]?.statement).toBe("不要删除数据");
    expect(result.boundaries[0]?.owner).toBe("user");
    expect(result.boundaries[0]?.source.type).toBe("user_directive");
    expect(result.stopConditions[0]?.condition).toBe("所有交付物完成");
    expect(result.assumptions[0]?.statement).toBe("网络可用");
    expect(result.scope.in).toHaveLength(1);
    expect(result.scope.in[0]?.statement).toBe("src/");
    expect(result.scope.out).toHaveLength(1);
    expect(result.scope.out[0]?.statement).toBe("data/");
  });

  it("removes boundaries, stop conditions, assumptions and scope by identity", () => {
    const contract = makeContract({
      boundaries: [
        {
          boundaryId: "b1",
          kind: "scope",
          severity: "soft",
          statement: "不要删除数据",
          source: { type: "user_directive", confidence: 1 },
          owner: "user",
          overridable: true,
          appliesTo: {},
          confidence: 1,
          status: "active",
          validFrom: ISO_BASE,
        },
      ],
      stopConditions: [{ condition: "全部完成", isMet: false, evidenceRequired: false }],
      assumptions: [
        { statement: "网络可用", source: "user_directive", confidence: 1, status: "active" },
      ],
      scope: {
        in: [
          {
            statement: "src/",
            source: "user_directive",
            appliesTo: {},
            readonly: false,
            writable: true,
            outbound: false,
            confidence: 1,
          },
        ],
        out: [],
      },
    });
    const proposal = proposeContractPatch({
      contract,
      instruction: "删除边界：不要删除数据。删除停止条件：全部完成。删除假设：网络可用。删除范围：src/。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(proposal.operations).toHaveLength(4);
    const result = applyContractPatch(contract, proposal);
    expect(result.boundaries).toHaveLength(0);
    expect(result.stopConditions).toHaveLength(0);
    expect(result.assumptions).toHaveLength(0);
    expect(result.scope.in).toHaveLength(0);
  });

  it("records high-impact ambiguities with decisionRequired and keeps the last conflicting directive", () => {
    const contract = makeContract();
    const conflicting = proposeContractPatch({
      contract,
      instruction: "预算 100 工具调用。预算 200 工具调用。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(conflicting.operations).toHaveLength(1);
    expect(conflicting.ambiguities).toHaveLength(1);
    expect(conflicting.ambiguities[0]?.kind).toBe("conflicting_directives");
    expect(conflicting.ambiguities[0]?.decisionRequired).toBe(true);
    expect(conflicting.ambiguities[0]?.sourceSpans.length).toBeGreaterThanOrEqual(1);
    const applied = applyContractPatch(contract, conflicting);
    expect(applied.budgets.maxToolCallsPerTask).toBe(200);

    const unitless = proposeContractPatch({
      contract: makeContract(),
      instruction: "预算 500。标题改为 X。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(unitless.operations).toHaveLength(1);
    expect(unitless.ambiguities[0]?.kind).toBe("budget_unclear");
    expect(unitless.ambiguities[0]?.decisionRequired).toBe(true);

    const unresolvedRemoval = proposeContractPatch({
      contract: makeContract(),
      instruction: "删除交付物：不存在的东西。标题改为 X。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(unresolvedRemoval.ambiguities[0]?.kind).toBe("deliverable_unclear");
    expect(unresolvedRemoval.ambiguities[0]?.decisionRequired).toBe(true);
  });

  it("never upgrades a peer to user_directive tier", () => {
    const contract = makeContract();
    const proposal = proposeContractPatch({
      contract,
      instruction: "标题改为 同行标题。",
      actor: PEER,
      createdAt: ISO_PROPOSAL,
    });
    expect(proposal.sourceTier).toBe("inferred");
    expect(proposal.owner).toBe("inferred");
    expect(ContractPatchProposalSchema.safeParse(proposal).success).toBe(true);
    const result = applyContractPatch(contract, proposal);
    expect(result.title).toBe("同行标题");
  });
});

describe("applyContractPatch rejection paths", () => {
  it("rejects NaN, non-integer, non-positive and object values on budget fields", () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    for (const value of [NaN, 1.5, -1, polluted]) {
      const contract = makeContract();
      const proposal = makeProposal(contract, [
        { op: "set_field", path: { section: "budgets", field: "maxToolCallsPerTask" }, value },
      ]);
      const err = captureSestinaError(() => applyContractPatch(contract, proposal));
      expect(err.code).toBe(SestinaErrorCode.validation_failed);
      expect(err.details).toMatchObject({ op: "set_field" });
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects duplicate identities within one proposal", () => {
    const c1 = makeContract();
    const dupUpsert = makeProposal(c1, [upsertDeliverableOp("dx", "甲"), upsertDeliverableOp("dx", "乙")]);
    const e1 = captureSestinaError(() => applyContractPatch(c1, dupUpsert));
    expect(e1.code).toBe(SestinaErrorCode.validation_failed);
    expect(e1.details).toMatchObject({ op: "upsert_deliverable", deliverableId: "dx" });

    const c2 = makeContract();
    const dupBoundary = makeProposal(c2, [addBoundaryOp("bx", "甲"), addBoundaryOp("bx", "乙")]);
    const e2 = captureSestinaError(() => applyContractPatch(c2, dupBoundary));
    expect(e2.code).toBe(SestinaErrorCode.validation_failed);
    expect(e2.details).toMatchObject({ op: "add_boundary", boundaryId: "bx" });

    const c3 = makeContract({ correctionRefs: ["c-exists"] });
    const dupCorrection = makeProposal(c3, [{ op: "append_correction_ref", correctionId: "c-exists" }]);
    const e3 = captureSestinaError(() => applyContractPatch(c3, dupCorrection));
    expect(e3.code).toBe(SestinaErrorCode.validation_failed);
    expect(e3.details).toMatchObject({ op: "append_correction_ref", correctionId: "c-exists" });
  });

  it("rejects removal of absent identities and names the op in the details", () => {
    const cases: {
      build: (c: TaskContract) => ContractPatchProposal;
      expected: Record<string, unknown>;
    }[] = [
      {
        build: (c) => makeProposal(c, [{ op: "remove_deliverable", deliverableId: "nope" }]),
        expected: { op: "remove_deliverable", deliverableId: "nope" },
      },
      {
        build: (c) => makeProposal(c, [{ op: "remove_boundary", boundaryId: "nope" }]),
        expected: { op: "remove_boundary", boundaryId: "nope" },
      },
      {
        build: (c) => makeProposal(c, [{ op: "remove_scope_in", statement: "nope" }]),
        expected: { op: "remove_scope_in", statement: "nope" },
      },
      {
        build: (c) => makeProposal(c, [{ op: "remove_scope_out", statement: "nope" }]),
        expected: { op: "remove_scope_out", statement: "nope" },
      },
      {
        build: (c) => makeProposal(c, [{ op: "remove_stop_condition", condition: "nope" }]),
        expected: { op: "remove_stop_condition", condition: "nope" },
      },
      {
        build: (c) => makeProposal(c, [{ op: "remove_assumption", statement: "nope" }]),
        expected: { op: "remove_assumption", statement: "nope" },
      },
      {
        build: (c) =>
          makeProposal(c, [
            { op: "supersede_preauthorization", preauthorizationId: "01JABCDEFGHJKMNPQRSTVWXYZ0" },
          ]),
        expected: {
          op: "supersede_preauthorization",
          preauthorizationId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
        },
      },
    ];
    for (const { build, expected } of cases) {
      const contract = makeContract();
      const err = captureSestinaError(() => applyContractPatch(contract, build(contract)));
      expect(err.code).toBe(SestinaErrorCode.validation_failed);
      expect(err.details).toMatchObject(expected);
    }
  });

  it("applies operations in array order so a later op may remove what an earlier one added", () => {
    const contract = makeContract();
    const proposal = makeProposal(contract, [
      { op: "set_field", path: { section: "title" }, value: "先" },
      { op: "set_field", path: { section: "title" }, value: "后" },
      upsertDeliverableOp("dy", "临时"),
      { op: "remove_deliverable", deliverableId: "dy" },
    ]);
    const result = applyContractPatch(contract, proposal);
    expect(result.title).toBe("后");
    expect(result.deliverables.map((d) => d.deliverableId)).toEqual(["d1"]);
  });

  it("rejects proposals carrying unknown op kinds or illegal field paths", () => {
    const c1 = makeContract();
    const unknownOp = makeProposal(c1, [{ op: "explode" } as unknown as ContractPatchOperation]);
    const e1 = captureSestinaError(() => applyContractPatch(c1, unknownOp));
    expect(e1.code).toBe(SestinaErrorCode.validation_failed);

    const c2 = makeContract();
    const illegalPath = makeProposal(c2, [
      { op: "set_field", path: { section: "unknown" }, value: "x" } as unknown as ContractPatchOperation,
    ]);
    const e2 = captureSestinaError(() => applyContractPatch(c2, illegalPath));
    expect(e2.code).toBe(SestinaErrorCode.validation_failed);
  });
});

describe("proposeContractPatch extractor fallback", () => {
  function extractorProposal(
    contract: TaskContract,
    operations: ContractPatchOperation[],
    now: string,
  ): ContractPatchProposal {
    return makeProposal(contract, operations, {
      sourceTier: "inferred",
      owner: "inferred",
      sourceRefs: [{ ref: "ext-1", type: "external" }],
      createdAt: now,
    });
  }

  function fakeExtractor(
    proposal: ContractPatchProposal | undefined,
    calls: { count: number },
  ): ContractSemanticExtractor {
    return {
      extractorId: "fake",
      propose: () => {
        calls.count += 1;
        return proposal;
      },
    };
  }

  it("falls back to the extractor only when nothing is recognized, and never applies anything", () => {
    const contract = makeContract();
    const calls = { count: 0 };
    const extractor = fakeExtractor(
      extractorProposal(contract, [setTitleOp("推断的标题")], ISO_PROPOSAL),
      calls,
    );
    const before = JSON.stringify(contract);
    const proposal = proposeContractPatch({
      contract,
      instruction: "请帮我看看有什么问题。",
      actor: PEER,
      createdAt: ISO_PROPOSAL,
      extractor,
    });
    expect(calls.count).toBe(1);
    expect(proposal.sourceTier).toBe("inferred");
    expect(proposal.owner).toBe("inferred");
    expect(proposal.operations).toEqual([setTitleOp("推断的标题")]);
    expect(proposal.sourceRefs).toEqual([{ ref: "ext-1", type: "external" }]);
    expect(JSON.stringify(contract)).toBe(before);
    expect(contract.title).toBe("初始契约");

    const recognizedCalls = { count: 0 };
    const recognized = proposeContractPatch({
      contract: makeContract(),
      instruction: "标题改为 已知。",
      actor: PEER,
      createdAt: ISO_PROPOSAL,
      extractor: fakeExtractor(undefined, recognizedCalls),
    });
    expect(recognizedCalls.count).toBe(0);
    expect(recognized.sourceTier).toBe("inferred");
    expect(recognized.owner).toBe("inferred");
    expect(recognized.operations[0]).toMatchObject({ op: "set_field", value: "已知" });
  });

  it("collapses repeated upsert directives for the same deliverable into one operation", () => {
    // Existing deliverable: both matches reuse the same identity; two upsert
    // ops with one deliverableId would make strict apply throw.
    const existingContract = makeContract();
    const existingProposal = proposeContractPatch({
      contract: existingContract,
      instruction: "新增交付物：报告。新增交付物：报告。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(existingProposal.operations).toHaveLength(1);
    expect(existingProposal.operations[0]).toMatchObject({ op: "upsert_deliverable" });
    const appliedExisting = applyContractPatch(existingContract, existingProposal);
    expect(appliedExisting.deliverables).toHaveLength(1);
    expect(appliedExisting.deliverables[0].deliverableId).toBe("d1");

    // New deliverable: the same description stated twice in one instruction
    // is one deliverable, not two identical entries.
    const freshContract = makeContract();
    const freshProposal = proposeContractPatch({
      contract: freshContract,
      instruction: "新增交付物：核查清单。新增交付物：核查清单。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(freshProposal.operations).toHaveLength(1);
    const appliedFresh = applyContractPatch(freshContract, freshProposal);
    expect(appliedFresh.deliverables.map((d) => d.description)).toEqual(["报告", "核查清单"]);
  });

  it("an intervening removal keeps the upserts apart but same-field conflict resolution keeps the last directive", () => {
    // add, remove, add on one identity is a same-field conflict: the last
    // directive wins and a conflicting_directives ambiguity is surfaced (the
    // established policy for repeated directives, not this collapse).
    const contract = makeContract();
    const proposal = proposeContractPatch({
      contract,
      instruction: "新增交付物：报告。删除交付物：报告。新增交付物：报告。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
    });
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]?.op).toBe("upsert_deliverable");
    expect(proposal.ambiguities.filter((a) => a.kind === "conflicting_directives")).toHaveLength(2);
    const applied = applyContractPatch(contract, proposal);
    expect(applied.deliverables).toHaveLength(1);
    expect(applied.deliverables[0].deliverableId).toBe("d1");
  });

  it("keeps extractor-derived proposals inferred even for a direct user, and throws when nothing remains", () => {
    const contract = makeContract();
    const proposal = proposeContractPatch({
      contract,
      instruction: "请帮我看看有什么问题。",
      actor: DIRECT_USER,
      createdAt: ISO_PROPOSAL,
      extractor: fakeExtractor(
        extractorProposal(contract, [setTitleOp("推断的标题")], ISO_PROPOSAL),
        { count: 0 },
      ),
    });
    expect(proposal.sourceTier).toBe("inferred");
    expect(proposal.owner).toBe("inferred");

    const noExtractorErr = captureSestinaError(() =>
      proposeContractPatch({
        contract: makeContract(),
        instruction: "请帮我看看有什么问题。",
        actor: DIRECT_USER,
        createdAt: ISO_PROPOSAL,
      }),
    );
    expect(noExtractorErr.code).toBe(SestinaErrorCode.validation_failed);
    expect(noExtractorErr.message).toContain("no explicit patch operations recognized");

    const emptyErr = captureSestinaError(() =>
      proposeContractPatch({
        contract: makeContract(),
        instruction: "请帮我看看有什么问题。",
        actor: PEER,
        createdAt: ISO_PROPOSAL,
        extractor: fakeExtractor(undefined, { count: 0 }),
      }),
    );
    expect(emptyErr.code).toBe(SestinaErrorCode.validation_failed);
  });

  it("a forged directUser cast on a direct channel can never author user directives", () => {
    // Cast-forged provenance that bypasses the schema refine: directUser on
    // a direct channel, but the actor is an agent. canActAsDirectUser alone
    // is true here; user_directive attribution must additionally require
    // actor === "user".
    const forged = { actor: "agent", channel: "desktop", directUser: true } as ActorProvenance;
    expect(canActAsDirectUser(forged)).toBe(true); // documents the gap
    const proposal = proposeContractPatch({
      contract: makeContract(),
      instruction: "标题改为 伪造指令。",
      actor: forged,
      createdAt: ISO_PROPOSAL,
    });
    expect(proposal.sourceTier).toBe("inferred");
    expect(proposal.owner).toBe("inferred");
  });
});

describe("patch operation schema hardening", () => {
  it("rejects illegal paths, unknown keys and prototype-polluting keys", () => {
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "set_field",
        path: { section: "unknown" },
        value: "x",
      }).success,
    ).toBe(false);
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "set_field",
        path: { section: "title" },
        value: "x",
        extra: 1,
      }).success,
    ).toBe(false);
    // zod's strict mode passes the "__proto__" own key from JSON.parse
    // through (it never reaches Object.prototype), so the enforceable
    // guarantee lives in the apply layer: object values are rejected by
    // field validation before any assignment happens.
    const protoValue = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    const protoContract = makeContract();
    const protoErr = captureSestinaError(() =>
      applyContractPatch(
        protoContract,
        makeProposal(protoContract, [
          { op: "set_field", path: { section: "title" }, value: protoValue },
        ]),
      ),
    );
    expect(protoErr.code).toBe(SestinaErrorCode.validation_failed);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "set_field",
        path: { section: "title" },
        value: "x",
        constructor: 1,
      }).success,
    ).toBe(false);
    expect(ContractPatchOperationSchema.safeParse({ op: "no_such_op" }).success).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("addresses arrays by identity, never by index", () => {
    const minimalValidOps: unknown[] = [
      { op: "set_field", path: { section: "title" }, value: "x" },
      { op: "set_field", path: { section: "objective", field: "priority" }, value: "normal" },
      {
        op: "upsert_deliverable",
        deliverable: {
          deliverableId: "a",
          description: "d",
          acceptanceChecks: [],
          required: true,
          status: "not_started",
          evidenceRefs: [],
        },
      },
      { op: "remove_deliverable", deliverableId: "a" },
      {
        op: "add_scope_in",
        item: {
          statement: "s",
          source: "user_directive",
          appliesTo: {},
          readonly: false,
          writable: true,
          outbound: false,
          confidence: 1,
        },
      },
      {
        op: "add_scope_out",
        item: {
          statement: "s",
          source: "user_directive",
          appliesTo: {},
          readonly: false,
          writable: true,
          outbound: true,
          confidence: 1,
        },
      },
      { op: "remove_scope_in", statement: "s" },
      { op: "remove_scope_out", statement: "s" },
      {
        op: "add_boundary",
        boundary: {
          boundaryId: "b",
          kind: "scope",
          severity: "soft",
          statement: "s",
          source: { type: "user_directive", confidence: 1 },
          owner: "user",
          overridable: true,
          appliesTo: {},
          confidence: 1,
          status: "active",
          validFrom: ISO_BASE,
        },
      },
      { op: "remove_boundary", boundaryId: "b" },
      {
        op: "add_stop_condition",
        condition: { condition: "c", isMet: false, evidenceRequired: false },
      },
      { op: "remove_stop_condition", condition: "c" },
      {
        op: "add_assumption",
        assumption: { statement: "s", source: "user_directive", confidence: 1, status: "active" },
      },
      { op: "remove_assumption", statement: "s" },
      { op: "append_correction_ref", correctionId: "c" },
      {
        op: "add_preauthorization",
        preauthorization: {
          schemaVersion: "1.0.0",
          preauthorizationId: generateId(),
          projectId: generateId(),
          taskId: generateId(),
          source: { host: "desktop" },
          target: { host: "claude_code" },
          deliverableIds: [],
          pathScope: [],
          actionCategories: ["read"],
          confirmedBy: { actor: "user", channel: "desktop", directUser: true },
          contractVersion: 1,
          status: "active",
          confirmedAt: ISO_BASE,
        },
      },
      { op: "supersede_preauthorization", preauthorizationId: "01JABCDEFGHJKMNPQRSTVWXYZ0" },
    ];
    for (const op of minimalValidOps) {
      expect(ContractPatchOperationSchema.safeParse(op).success, JSON.stringify(op)).toBe(true);
    }
    // Index-based addressing does not exist: identity fields are the only
    // handle, and index-shaped keys are rejected by the strict variants.
    expect(
      ContractPatchOperationSchema.safeParse({ op: "remove_deliverable", deliverableId: "a", index: 0 }).success,
    ).toBe(false);
    expect(
      ContractPatchOperationSchema.safeParse({ op: "remove_scope_in", statement: "s", index: 1 }).success,
    ).toBe(false);
  });
});
