import { describe, expect, it } from "vitest";
import {
  generateId,
  isSestinaError,
  SestinaError,
  SestinaErrorCode,
  type ContractPatchOperation,
  type ContractPatchProposal,
  type ContractSourceTier,
  type TaskContract,
} from "@sestina/schema";
import { applyContractPatch } from "../src/patch.js";
import { mergeConcurrentPatches } from "../src/merge.js";
import { assertExpectedVersion, nextContractVersion } from "../src/versioning.js";
import { assertNoConflicts, buildContractConflictId } from "../src/conflicts.js";

const ISO_BASE = "2026-08-14T00:00:00.000Z";
const T_SAME = "2026-08-15T00:00:00.000Z";

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
    sourceRefs: [],
    createdAt: ISO_BASE,
    updatedAt: ISO_BASE,
    ...overrides,
  };
}

interface MakePatchOverrides {
  proposalId?: string;
  tier?: ContractSourceTier;
  createdAt?: string;
  sourceRefs?: ContractPatchProposal["sourceRefs"];
}

function makePatch(
  contract: TaskContract,
  operations: ContractPatchOperation[],
  overrides: MakePatchOverrides = {},
): ContractPatchProposal {
  const tier = overrides.tier ?? "user_directive";
  return {
    schemaVersion: "1.0.0",
    proposalId: overrides.proposalId ?? generateId(),
    contractId: contract.contractId,
    taskId: contract.taskId,
    expectedVersion: contract.version,
    operations,
    sourceTier: tier,
    owner: tier === "inferred" ? "inferred" : "user",
    sourceRefs: overrides.sourceRefs ?? [],
    ambiguities: [],
    createdAt: overrides.createdAt ?? T_SAME,
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
    createdAt: T_SAME,
    ...overrides,
  };
}

const setTitle = (value: string): ContractPatchOperation => ({
  op: "set_field",
  path: { section: "title" },
  value,
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

describe("ContractConflict", () => {
  it("preserves both sides' full sources in a ContractConflict", () => {
    const base = makeContract();
    const p1 = makePatch(base, [setTitle("甲")], {
      tier: "user_directive",
      createdAt: T_SAME,
      sourceRefs: [{ ref: "u-1", type: "user_message", excerpt: "原文一" }],
    });
    const p2 = makePatch(base, [setTitle("乙")], {
      tier: "user_directive",
      createdAt: T_SAME,
      sourceRefs: [{ ref: "e-1", type: "external" }],
    });
    const outcome = mergeConcurrentPatches(base, [p1, p2]);
    expect(outcome.kind).toBe("conflicted");
    if (outcome.kind !== "conflicted") throw new Error("unreachable");
    const [conflict] = outcome.conflicts;
    expect(conflict).toBeDefined();
    expect(conflict?.conflictId).toMatch(/^[a-f0-9]{64}$/);
    expect(conflict?.description).toContain("title");
    const sides = conflict?.sides ?? [];
    expect(sides).toHaveLength(2);
    const side1 = sides.find((s) => s.proposalId === p1.proposalId);
    const side2 = sides.find((s) => s.proposalId === p2.proposalId);
    expect(side1).toEqual({
      proposalId: p1.proposalId,
      sourceTier: "user_directive",
      sourceRefs: [{ ref: "u-1", type: "user_message", excerpt: "原文一" }],
      createdAt: T_SAME,
    });
    expect(side2).toEqual({
      proposalId: p2.proposalId,
      sourceTier: "user_directive",
      sourceRefs: [{ ref: "e-1", type: "external" }],
      createdAt: T_SAME,
    });
  });
});

describe("assertNoConflicts", () => {
  it("narrows merged outcomes and throws contract_conflict with the conflicts as details", () => {
    const base = makeContract();
    const merged = mergeConcurrentPatches(base, [
      makePatch(base, [setTitle("标题")], { tier: "user_directive" }),
    ]);
    expect(merged.kind).toBe("merged");
    assertNoConflicts(merged);
    expect(merged.contract.title).toBe("标题");

    const p1 = makePatch(base, [setTitle("甲")], { tier: "user_directive", createdAt: T_SAME });
    const p2 = makePatch(base, [setTitle("乙")], { tier: "user_directive", createdAt: T_SAME });
    const conflicted = mergeConcurrentPatches(base, [p1, p2]);
    expect(conflicted.kind).toBe("conflicted");
    if (conflicted.kind !== "conflicted") throw new Error("unreachable");
    const err = captureSestinaError(() => {
      assertNoConflicts(conflicted);
    });
    expect(err.code).toBe(SestinaErrorCode.contract_conflict);
    expect(err.message).toBe("Concurrent contract patches conflict");
    expect(err.status).toBe(409);
    expect(err.details).toEqual(conflicted.conflicts);
    expect(err.details).toBe(conflicted.conflicts);
  });
});

describe("buildContractConflictId", () => {
  it("is deterministic and order-independent", () => {
    expect(buildContractConflictId("a", "b", "field")).toBe(
      buildContractConflictId("b", "a", "field"),
    );
    expect(buildContractConflictId("a", "b", "field")).toBe(
      buildContractConflictId("a", "b", "field"),
    );
    expect(buildContractConflictId("a", "b", "field")).not.toBe(
      buildContractConflictId("a", "c", "field"),
    );
    expect(buildContractConflictId("a", "b", "field")).not.toBe(
      buildContractConflictId("a", "b", "other"),
    );
    expect(buildContractConflictId("a", "b", "field")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("versioning", () => {
  it("assertExpectedVersion throws contract_version_mismatch with actual/expected details", () => {
    const contract = makeContract();
    expect(() => {
      assertExpectedVersion(contract, contract.version);
    }).not.toThrow();
    const err = captureSestinaError(() => {
      assertExpectedVersion(contract, 7);
    });
    expect(err.code).toBe(SestinaErrorCode.contract_version_mismatch);
    expect(err.details).toEqual({ actual: contract.version, expected: 7 });
  });

  it("nextContractVersion returns version + 1", () => {
    expect(nextContractVersion(makeContract())).toBe(4);
  });

  it("merge preconditions and apply reject stale versions with contract_version_mismatch", () => {
    const base = makeContract();
    const stalePatch = { ...makePatch(base, [setTitle("x")]), expectedVersion: base.version + 1 };
    const mergeErr = captureSestinaError(() => mergeConcurrentPatches(base, [stalePatch]));
    expect(mergeErr.code).toBe(SestinaErrorCode.contract_version_mismatch);
    expect(mergeErr.details).toEqual({ actual: base.version, expected: base.version + 1 });

    const applyContract = makeContract();
    const applyProposal = makeProposal(applyContract, [setTitle("x")], {
      expectedVersion: applyContract.version + 1,
    });
    const applyErr = captureSestinaError(() =>
      applyContractPatch(applyContract, applyProposal),
    );
    expect(applyErr.code).toBe(SestinaErrorCode.contract_version_mismatch);
    expect(applyErr.details).toEqual({ actual: applyContract.version, expected: applyContract.version + 1 });
  });
});

describe("applyContractPatch rejection paths", () => {
  it("rejects unknown ops, oversized values, NaN, wrong enums and duplicate identities", () => {
    const cases: (() => SestinaError)[] = [
      () => {
        const c = makeContract();
        return captureSestinaError(() =>
          applyContractPatch(
            c,
            makeProposal(c, [{ op: "explode" } as unknown as ContractPatchOperation]),
          ),
        );
      },
      () => {
        const c = makeContract();
        return captureSestinaError(() =>
          applyContractPatch(
            c,
            makeProposal(c, [{ op: "set_field", path: { section: "title" }, value: "x".repeat(501) }]),
          ),
        );
      },
      () => {
        const c = makeContract();
        return captureSestinaError(() =>
          applyContractPatch(
            c,
            makeProposal(c, [
              { op: "set_field", path: { section: "budgets", field: "maxToolCallsPerTask" }, value: NaN },
            ]),
          ),
        );
      },
      () => {
        const c = makeContract();
        return captureSestinaError(() =>
          applyContractPatch(
            c,
            makeProposal(c, [
              { op: "set_field", path: { section: "objective", field: "priority" }, value: "urgent" },
            ]),
          ),
        );
      },
      () => {
        const c = makeContract();
        return captureSestinaError(() =>
          applyContractPatch(
            c,
            makeProposal(c, [
              {
                op: "upsert_deliverable",
                deliverable: {
                  deliverableId: "dup",
                  description: "甲",
                  acceptanceChecks: [],
                  required: true,
                  status: "not_started",
                  evidenceRefs: [],
                },
              },
              {
                op: "upsert_deliverable",
                deliverable: {
                  deliverableId: "dup",
                  description: "乙",
                  acceptanceChecks: [],
                  required: true,
                  status: "not_started",
                  evidenceRefs: [],
                },
              },
            ]),
          ),
        );
      },
      () => {
        const c = makeContract();
        return captureSestinaError(() =>
          applyContractPatch(
            c,
            makeProposal(c, [
              {
                op: "set_field",
                path: { section: "unknown" },
                value: "x",
              } as unknown as ContractPatchOperation,
            ]),
          ),
        );
      },
    ];
    for (const run of cases) {
      expect(run().code).toBe(SestinaErrorCode.validation_failed);
    }
  });
});
