import { describe, expect, it } from "vitest";
import {
  CONTRACT_SOURCE_TIER_PRECEDENCE,
  generateId,
  isSestinaError,
  SestinaError,
  SestinaErrorCode,
  type ContractPatchOperation,
  type ContractPatchProposal,
  type ContractSourceTier,
  type TaskContract,
} from "@sestina/schema";
import { mergeConcurrentPatches } from "../src/merge.js";

const ISO_BASE = "2026-08-14T00:00:00.000Z";
const T_SAME = "2026-08-15T00:00:00.000Z";
const T_EARLIER = "2026-08-15T08:00:00.000Z";
const T_LATER = "2026-08-15T09:00:00.000Z";

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

const setTitle = (value: string): ContractPatchOperation => ({
  op: "set_field",
  path: { section: "title" },
  value,
});

const upsertDeliverable = (id: string, description: string): ContractPatchOperation => ({
  op: "upsert_deliverable",
  deliverable: {
    deliverableId: id,
    description,
    acceptanceChecks: [],
    required: true,
    status: "not_started",
    evidenceRefs: [],
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

describe("mergeConcurrentPatches", () => {
  it("replays disjoint fields from concurrent patches and keeps base version and timestamps", () => {
    const base = makeContract();
    const p1 = makePatch(base, [setTitle("用户标题")], { tier: "user_directive" });
    const p2 = makePatch(base, [upsertDeliverable("d2", "核查清单")], { tier: "inferred" });
    const outcome = mergeConcurrentPatches(base, [p1, p2]);
    expect(outcome.kind).toBe("merged");
    if (outcome.kind !== "merged") throw new Error("unreachable");
    expect(outcome.contract.title).toBe("用户标题");
    expect(outcome.contract.deliverables.map((d) => d.deliverableId).sort()).toEqual(["d1", "d2"]);
    expect(outcome.contract.version).toBe(base.version);
    expect(outcome.contract.createdAt).toBe(base.createdAt);
    expect(outcome.contract.updatedAt).toBe(base.updatedAt);
    expect(outcome.superseded).toEqual([]);
    expect(outcome.contract).not.toBe(base);
    expect(outcome.contract.deliverables).not.toBe(base.deliverables);
  });

  it("replays a single patch wholesale", () => {
    const base = makeContract();
    const patch = makePatch(base, [setTitle("单补丁"), upsertDeliverable("d2", "新交付物")], {
      tier: "inferred",
    });
    const outcome = mergeConcurrentPatches(base, [patch]);
    expect(outcome.kind).toBe("merged");
    if (outcome.kind !== "merged") throw new Error("unreachable");
    expect(outcome.contract.title).toBe("单补丁");
    expect(outcome.contract.deliverables.map((d) => d.deliverableId).sort()).toEqual(["d1", "d2"]);
    expect(outcome.superseded).toEqual([]);
  });

  it("resolves one logical field across all seven tiers, highest tier wins", () => {
    const base = makeContract();
    const patches = CONTRACT_SOURCE_TIER_PRECEDENCE.map((tier, i) =>
      makePatch(base, [setTitle(`title-${tier}`)], {
        tier,
        createdAt: `2026-08-15T0${i}:00:00.000Z`,
      }),
    );
    const outcome = mergeConcurrentPatches(base, patches);
    expect(outcome.kind).toBe("merged");
    if (outcome.kind !== "merged") throw new Error("unreachable");
    expect(outcome.contract.title).toBe("title-system_safety");
    expect(outcome.superseded).toHaveLength(6);
    const winnerId = patches[0]?.proposalId;
    expect(winnerId).toBeDefined();
    for (const relation of outcome.superseded) {
      expect(relation.winnerProposalId).toBe(winnerId);
      expect(relation.winnerTier).toBe("system_safety");
      expect(relation.winnerCreatedAt).toBe("2026-08-15T00:00:00.000Z");
    }
    expect(outcome.superseded.map((r) => r.supersededProposalId).sort()).toEqual(
      patches.slice(1).map((p) => p.proposalId).sort(),
    );
  });

  it("gives the higher tier precedence pairwise across the ladder", () => {
    for (let i = 0; i < CONTRACT_SOURCE_TIER_PRECEDENCE.length - 1; i += 1) {
      const higher = CONTRACT_SOURCE_TIER_PRECEDENCE[i];
      const lower = CONTRACT_SOURCE_TIER_PRECEDENCE[i + 1];
      if (!higher || !lower) throw new Error("unreachable");
      const base = makeContract();
      const pHigher = makePatch(base, [setTitle("higher")], { tier: higher, createdAt: T_EARLIER });
      const pLower = makePatch(base, [setTitle("lower")], { tier: lower, createdAt: T_LATER });
      const outcome = mergeConcurrentPatches(base, [pHigher, pLower]);
      expect(outcome.kind, `${higher} vs ${lower}`).toBe("merged");
      if (outcome.kind !== "merged") throw new Error("unreachable");
      expect(outcome.contract.title).toBe("higher");
      expect(outcome.superseded).toEqual([
        {
          winnerProposalId: pHigher.proposalId,
          supersededProposalId: pLower.proposalId,
          winnerTier: higher,
          winnerCreatedAt: T_EARLIER,
          supersededCreatedAt: T_LATER,
        },
      ]);
    }
  });

  it("conflicts when two patches at the same tier share a createdAt, preserving both sides", () => {
    const base = makeContract();
    const p1 = makePatch(base, [setTitle("甲")], {
      tier: "user_directive",
      createdAt: T_SAME,
      sourceRefs: [{ ref: "r1", type: "user_message" }],
    });
    const p2 = makePatch(base, [setTitle("乙")], {
      tier: "user_directive",
      createdAt: T_SAME,
      sourceRefs: [{ ref: "r2", type: "external" }],
    });
    const outcome = mergeConcurrentPatches(base, [p1, p2]);
    expect(outcome.kind).toBe("conflicted");
    if (outcome.kind !== "conflicted") throw new Error("unreachable");
    expect(outcome.conflicts).toHaveLength(1);
    const conflict = outcome.conflicts[0];
    if (!conflict) throw new Error("unreachable");
    expect(conflict.sides).toHaveLength(2);
    const byId = new Map(conflict.sides.map((s) => [s.proposalId, s]));
    expect(byId.get(p1.proposalId)).toEqual({
      proposalId: p1.proposalId,
      sourceTier: "user_directive",
      sourceRefs: [{ ref: "r1", type: "user_message" }],
      createdAt: T_SAME,
    });
    expect(byId.get(p2.proposalId)).toEqual({
      proposalId: p2.proposalId,
      sourceTier: "user_directive",
      sourceRefs: [{ ref: "r2", type: "external" }],
      createdAt: T_SAME,
    });
  });

  it("lets the later createdAt win within a tier and records a SupersededRelation", () => {
    const base = makeContract();
    const pEarly = makePatch(base, [setTitle("早")], { tier: "user_directive", createdAt: T_EARLIER });
    const pLate = makePatch(base, [setTitle("晚")], { tier: "user_directive", createdAt: T_LATER });
    const outcome = mergeConcurrentPatches(base, [pEarly, pLate]);
    expect(outcome.kind).toBe("merged");
    if (outcome.kind !== "merged") throw new Error("unreachable");
    expect(outcome.contract.title).toBe("晚");
    expect(outcome.superseded).toEqual([
      {
        winnerProposalId: pLate.proposalId,
        supersededProposalId: pEarly.proposalId,
        winnerTier: "user_directive",
        winnerCreatedAt: T_LATER,
        supersededCreatedAt: T_EARLIER,
      },
    ]);
  });

  it("merges array identities: distinct ids coexist, same id resolves by tier, ties conflict", () => {
    const base1 = makeContract();
    const pA = makePatch(base1, [upsertDeliverable("d2", "甲")], { tier: "inferred" });
    const pB = makePatch(base1, [upsertDeliverable("d3", "乙")], { tier: "inferred" });
    const distinct = mergeConcurrentPatches(base1, [pA, pB]);
    expect(distinct.kind).toBe("merged");
    if (distinct.kind !== "merged") throw new Error("unreachable");
    expect(distinct.contract.deliverables.map((d) => d.deliverableId).sort()).toEqual([
      "d1",
      "d2",
      "d3",
    ]);

    const base2 = makeContract();
    const pHigh = makePatch(base2, [upsertDeliverable("d1", "用户版")], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    const pLow = makePatch(base2, [upsertDeliverable("d1", "模板版")], {
      tier: "template",
      createdAt: T_SAME,
    });
    const tierResolved = mergeConcurrentPatches(base2, [pHigh, pLow]);
    expect(tierResolved.kind).toBe("merged");
    if (tierResolved.kind !== "merged") throw new Error("unreachable");
    expect(tierResolved.contract.deliverables).toHaveLength(1);
    expect(
      tierResolved.contract.deliverables.find((d) => d.deliverableId === "d1")?.description,
    ).toBe("用户版");

    const base3 = makeContract();
    const pX = makePatch(base3, [upsertDeliverable("d1", "甲")], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    const pY = makePatch(base3, [upsertDeliverable("d1", "乙")], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    expect(mergeConcurrentPatches(base3, [pX, pY]).kind).toBe("conflicted");
  });

  it("treats presence vs removal on the same identity as one logical field", () => {
    const base1 = makeContract();
    const pKeep = makePatch(base1, [upsertDeliverable("d1", "保留版")], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    const pDrop = makePatch(base1, [{ op: "remove_deliverable", deliverableId: "d1" }], {
      tier: "inferred",
      createdAt: T_SAME,
    });
    const kept = mergeConcurrentPatches(base1, [pKeep, pDrop]);
    expect(kept.kind).toBe("merged");
    if (kept.kind !== "merged") throw new Error("unreachable");
    expect(kept.contract.deliverables.find((d) => d.deliverableId === "d1")?.description).toBe(
      "保留版",
    );

    const base2 = makeContract();
    const pRemove = makePatch(base2, [{ op: "remove_deliverable", deliverableId: "d1" }], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    const pAdd = makePatch(base2, [upsertDeliverable("d1", "新内容")], {
      tier: "inferred",
      createdAt: T_SAME,
    });
    const removed = mergeConcurrentPatches(base2, [pRemove, pAdd]);
    expect(removed.kind).toBe("merged");
    if (removed.kind !== "merged") throw new Error("unreachable");
    expect(removed.contract.deliverables).toHaveLength(0);

    const base3 = makeContract();
    const pU = makePatch(base3, [upsertDeliverable("d1", "内容")], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    const pR = makePatch(base3, [{ op: "remove_deliverable", deliverableId: "d1" }], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    expect(mergeConcurrentPatches(base3, [pU, pR]).kind).toBe("conflicted");

    const base4 = makeContract({
      boundaries: [
        {
          boundaryId: "b1",
          kind: "scope",
          severity: "soft",
          statement: "原边界",
          source: { type: "user_directive", confidence: 1 },
          owner: "user",
          overridable: true,
          appliesTo: {},
          confidence: 1,
          status: "active",
          validFrom: ISO_BASE,
        },
      ],
    });
    const pBKeep = makePatch(base4, [{ op: "remove_boundary", boundaryId: "b1" }], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    const pBDrop = makePatch(
      base4,
      [
        {
          op: "add_boundary",
          boundary: {
            boundaryId: "b1",
            kind: "scope",
            severity: "soft",
            statement: "新边界",
            source: { type: "template", confidence: 0.5 },
            owner: "project",
            overridable: true,
            appliesTo: {},
            confidence: 0.5,
            status: "active",
            validFrom: ISO_BASE,
          },
        },
      ],
      { tier: "template", createdAt: T_SAME },
    );
    const bOutcome = mergeConcurrentPatches(base4, [pBKeep, pBDrop]);
    expect(bOutcome.kind).toBe("merged");
    if (bOutcome.kind !== "merged") throw new Error("unreachable");
    expect(bOutcome.contract.boundaries).toHaveLength(0);

    const base5 = makeContract();
    const pSAdd = makePatch(
      base5,
      [{ op: "add_stop_condition", condition: { condition: "全部完成", isMet: false, evidenceRequired: false } }],
      { tier: "user_directive", createdAt: T_SAME },
    );
    const pSDel = makePatch(base5, [{ op: "remove_stop_condition", condition: "全部完成" }], {
      tier: "user_directive",
      createdAt: T_SAME,
    });
    expect(mergeConcurrentPatches(base5, [pSAdd, pSDel]).kind).toBe("conflicted");
  });

  it("is order-independent for merged outcomes (all permutations)", () => {
    const base = makeContract();
    const p1 = makePatch(base, [setTitle("甲")], { tier: "user_directive", createdAt: T_EARLIER });
    const p2 = makePatch(base, [upsertDeliverable("d2", "核查清单")], {
      tier: "inferred",
      createdAt: T_LATER,
    });
    const p3 = makePatch(base, [setTitle("乙")], { tier: "inferred", createdAt: T_EARLIER });
    const permutations: ContractPatchProposal[][] = [
      [p1, p2, p3],
      [p1, p3, p2],
      [p2, p1, p3],
      [p2, p3, p1],
      [p3, p1, p2],
      [p3, p2, p1],
    ];
    const first = permutations[0];
    if (!first) throw new Error("unreachable");
    const reference = mergeConcurrentPatches(base, first);
    expect(reference.kind).toBe("merged");
    if (reference.kind !== "merged") throw new Error("unreachable");
    expect(reference.contract.title).toBe("甲");
    expect(reference.contract.deliverables.map((d) => d.deliverableId).sort()).toEqual([
      "d1",
      "d2",
    ]);
    expect(reference.superseded).toHaveLength(1);
    expect(reference.superseded[0]?.winnerProposalId).toBe(p1.proposalId);
    expect(reference.superseded[0]?.supersededProposalId).toBe(p3.proposalId);
    for (const permutation of permutations.slice(1)) {
      expect(mergeConcurrentPatches(base, permutation)).toEqual(reference);
    }
  });

  it("is order-independent when conflicts are present", () => {
    const base = makeContract();
    const p1 = makePatch(base, [setTitle("甲")], { tier: "user_directive", createdAt: T_SAME });
    const p2 = makePatch(base, [setTitle("乙")], { tier: "user_directive", createdAt: T_SAME });
    const p3 = makePatch(base, [upsertDeliverable("d2", "核查清单")], {
      tier: "template",
      createdAt: T_LATER,
    });
    const permutations: ContractPatchProposal[][] = [
      [p1, p2, p3],
      [p1, p3, p2],
      [p2, p1, p3],
      [p2, p3, p1],
      [p3, p1, p2],
      [p3, p2, p1],
    ];
    const first = permutations[0];
    if (!first) throw new Error("unreachable");
    const reference = mergeConcurrentPatches(base, first);
    expect(reference.kind).toBe("conflicted");
    for (const permutation of permutations.slice(1)) {
      expect(mergeConcurrentPatches(base, permutation)).toEqual(reference);
    }
  });

  it("never mutates the patches array, its entries, or the base contract", () => {
    const base = makeContract();
    const p1 = makePatch(base, [setTitle("甲")], { tier: "user_directive" });
    const p2 = makePatch(base, [upsertDeliverable("d2", "乙")], { tier: "inferred" });
    const patches = [p1, p2];
    const baseBefore = JSON.stringify(base);
    const patchesBefore = JSON.stringify(patches);
    const outcome = mergeConcurrentPatches(base, patches);
    expect(outcome.kind).toBe("merged");
    expect(JSON.stringify(base)).toBe(baseBefore);
    expect(JSON.stringify(patches)).toBe(patchesBefore);
    expect(patches[0]).toBe(p1);
    expect(patches[1]).toBe(p2);
  });

  it("rejects patches with mismatched identity or version using contract_version_mismatch", () => {
    const base = makeContract();
    const other = makeContract();

    const wrongContract = makePatch(other, [setTitle("x")]);
    const e1 = captureSestinaError(() => mergeConcurrentPatches(base, [wrongContract]));
    expect(e1.code).toBe(SestinaErrorCode.contract_version_mismatch);
    expect(e1.details).toEqual({
      actual: { contractId: other.contractId, taskId: other.taskId },
      expected: { contractId: base.contractId, taskId: base.taskId },
    });

    const wrongTaskPatch = { ...makePatch(base, [setTitle("x")]), taskId: other.taskId };
    const e2 = captureSestinaError(() => mergeConcurrentPatches(base, [wrongTaskPatch]));
    expect(e2.code).toBe(SestinaErrorCode.contract_version_mismatch);

    const stalePatch = { ...makePatch(base, [setTitle("x")]), expectedVersion: base.version + 1 };
    const e3 = captureSestinaError(() => mergeConcurrentPatches(base, [stalePatch]));
    expect(e3.code).toBe(SestinaErrorCode.contract_version_mismatch);
    expect(e3.details).toEqual({ actual: base.version, expected: base.version + 1 });
  });
});
