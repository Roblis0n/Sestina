import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  SequenceIdFactory,
  createCorrectionAppeal,
  markCorrectionAppealRecordOnly,
  recordCorrectionAppeal,
  resolveCorrectionAppeal,
  stableResearchHash,
  type AppealSourceBinding,
} from "@sestina/research";
import { openDatabase, type StorageDatabase } from "@sestina/storage";
import { createResearchStore } from "../src/index.js";
import { makeScenario, USER_ACTOR } from "./fixtures.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function source(projectId: string, ids: SequenceIdFactory): AppealSourceBinding {
  const findingId = ids.create("rfnd_");
  const findingSnapshot = {
    id: findingId,
    kind: "argument_leap",
    severity: "warning" as const,
    rationale: "A mechanism is asserted without a linking premise.",
    minimumRecovery: "Add the missing premise.",
    decisionIds: [],
    issueIds: [],
    authority: "model_proposed" as const,
  };
  const createdStateBinding = {
    projectId,
    stateHash: "1".repeat(64),
    briefVersionId: ids.create("rbrf_"),
    briefVersionNumber: 2,
    decisions: [],
    issues: [],
  };
  const findingHash = stableResearchHash(findingSnapshot);
  const stateHash = stableResearchHash(createdStateBinding);
  const definition = "Does the frozen input introduce a conclusion without the premises required to support it?";
  const criterionHash = stableResearchHash({ id: "argument-leap", definition, version: "1.0.0" });
  if (!findingHash.ok || !stateHash.ok || !criterionHash.ok) throw new Error("hash failed");
  return {
    projectId,
    reviewId: ids.create("rrvw_"),
    receiptId: ids.create("rrcp_"),
    findingId,
    findingSchemaVersion: "1.0.0",
    findingSnapshot,
    findingHash: findingHash.value,
    suggestionHash: "2".repeat(64),
    sourceReceiptHash: "3".repeat(64),
    inputBindings: [{ artifactId: ids.create("rart_"), revisionId: ids.create("rrev_"), normalizedTextHash: "4".repeat(64) }],
    rubric: { criterionId: "argument-leap", version: "1.0.0", definition, hash: criterionHash.value, sourceRubricHash: "5".repeat(64) },
    createdStateBinding,
    createdStateBindingHash: stateHash.value,
  };
}

describe("SQLite correction appeal repository", () => {
  let dir: string;
  let path: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    path = join(dir, "sestina.db");
    db = await openDatabase({ path });
  });

  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("persists, reopens, pages, and project-isolates an appeal", async () => {
    const scenario = makeScenario(9_000);
    const store = createResearchStore(db);
    value(store.projects.create(scenario.project));
    const frozenSource = source(scenario.project.id, scenario.ids);
    const appeal = value(createCorrectionAppeal({
      source: frozenSource,
      statement: {
        disagreement: "The finding reads a bounded scenario as a causal claim.",
        challengedCriterionId: "argument-leap",
        claimedError: "The statement is conditional.",
        missingOrMisreadContext: "The preceding sentence defines a sensitivity scenario.",
        secondOpinionQuestion: "Is an unsupported causal mechanism actually present?",
      },
      actor: USER_ACTOR,
    }, { clock: scenario.clock, idFactory: scenario.ids }));

    expect(store.correctionAppeals.create(appeal)).toEqual({ ok: true, value: appeal });
    expect(store.correctionAppeals.getActiveBySource(scenario.project.id, frozenSource.reviewId, frozenSource.findingId)).toEqual({ ok: true, value: appeal });
    expect(store.correctionAppeals.listByProject(scenario.project.id, { limit: 1 })).toMatchObject({ ok: true, value: { items: [appeal] } });
    expect(store.correctionAppeals.getById(new SequenceIdFactory(12_000).create("rprj_"), appeal.id)).toEqual({ ok: true, value: undefined });

    db.close();
    db = await openDatabase({ path });
    expect(createResearchStore(db).correctionAppeals.getById(scenario.project.id, appeal.id)).toEqual({ ok: true, value: appeal });
  });

  it("enforces CAS and one unresolved appeal per project/review/Finding while allowing resolved lineage", () => {
    const scenario = makeScenario(9_500);
    const store = createResearchStore(db);
    value(store.projects.create(scenario.project));
    const frozenSource = source(scenario.project.id, scenario.ids);
    const first = value(createCorrectionAppeal({
      source: frozenSource,
      statement: {
        disagreement: "Disagreement one.",
        challengedCriterionId: "argument-leap",
        claimedError: "The criterion was applied to the wrong scope.",
        missingOrMisreadContext: "A condition was omitted.",
        secondOpinionQuestion: "Is the criterion present in the frozen scope?",
      },
      actor: USER_ACTOR,
    }, { clock: scenario.clock, idFactory: scenario.ids }));
    value(store.correctionAppeals.create(first));

    const duplicate = value(createCorrectionAppeal({
      source: frozenSource,
      statement: {
        disagreement: "Disagreement two.",
        challengedCriterionId: "argument-leap",
        claimedError: "The same Finding remains disputed.",
        missingOrMisreadContext: "The same condition remains relevant.",
        secondOpinionQuestion: "Recheck the same criterion.",
      },
      actor: USER_ACTOR,
    }, { clock: scenario.clock, idFactory: scenario.ids }));
    expect(store.correctionAppeals.create(duplicate)).toMatchObject({ ok: false, error: { code: "appeal_already_active" } });

    const recorded = value(recordCorrectionAppeal(first, { actor: USER_ACTOR, expectedVersion: first.version }, scenario.clock));
    expect(store.correctionAppeals.compareAndSwap(recorded, first.version)).toEqual({ ok: true, value: recorded });
    expect(store.correctionAppeals.compareAndSwap(recorded, first.version)).toMatchObject({ ok: false, error: { code: "version_conflict" } });
    const localOnly = value(markCorrectionAppealRecordOnly(recorded, { expectedVersion: recorded.version }, scenario.clock));
    value(store.correctionAppeals.compareAndSwap(localOnly, recorded.version));
    const resolved = value(resolveCorrectionAppeal(localOnly, {
      actor: USER_ACTOR,
      expectedVersion: localOnly.version,
      kind: "record_disagreement_without_resolution",
      publicReason: "Preserve the disagreement as unresolved research judgment.",
    }, { clock: scenario.clock, idFactory: scenario.ids }));
    value(store.correctionAppeals.compareAndSwap(resolved, localOnly.version));

    const reopened = value(createCorrectionAppeal({
      source: frozenSource,
      previousAppealId: resolved.id,
      statement: {
        disagreement: "New evidence justifies reopening the dispute.",
        challengedCriterionId: "argument-leap",
        claimedError: "The new context changes the disputed scope.",
        missingOrMisreadContext: "A newly recorded condition is relevant.",
        secondOpinionQuestion: "Assess the frozen source under the clarified question.",
      },
      actor: USER_ACTOR,
    }, { clock: scenario.clock, idFactory: scenario.ids }));
    expect(store.correctionAppeals.create(reopened)).toEqual({ ok: true, value: reopened });
    expect(value(store.correctionAppeals.getActiveBySource(scenario.project.id, frozenSource.reviewId, frozenSource.findingId))?.id).toBe(reopened.id);
  });
});
