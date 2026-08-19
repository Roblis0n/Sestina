import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  createResearchDecision,
  getDecisionStateAt,
  parseResearchDecision,
  queryActiveResearchDecisions,
  supersedeResearchDecision,
  transitionResearchDecision,
  type ResearchDecisionInput,
  type ResearchSource,
} from "../src/index.js";

const MODEL: ResearchSource = {
  actor: { kind: "model", model: "research-model" },
  authority: "model_proposed",
  recordedAt: "2026-08-19T03:00:00.000Z",
};

function environment(time = "2026-08-19T03:30:00.000Z") {
  return { clock: new FixedClock(time), idFactory: new SequenceIdFactory(800) };
}

function input(ids = new SequenceIdFactory(900)): ResearchDecisionInput {
  return {
    projectId: ids.create("rprj_"),
    statement: "Network materials must not enter the introduction",
    scope: { kind: "project" },
    rationale: "The brief limits evidence to the interview corpus",
    effectiveBriefVersionId: ids.create("rbrf_"),
    reopenConditions: ["The user explicitly expands the evidence boundary"],
    source: MODEL,
  };
}

describe("Decision Ledger", () => {
  it("creates an immutable proposed decision with a complete initial transition", () => {
    const result = createResearchDecision(input(), environment());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("proposed");
    expect(result.value.transitions).toHaveLength(1);
    expect(result.value.transitions[0]).toMatchObject({ from: null, to: "proposed" });
    expect(Object.isFrozen(result.value.transitions)).toBe(true);
  });

  it("permits only the declared state machine and preserves rejected decisions", () => {
    const env = environment();
    const created = createResearchDecision(input(), env);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const deferred = transitionResearchDecision(created.value, "deferred", { kind: "user", actorId: "lead" }, created.value.version, "Await data", env.clock);
    expect(deferred.ok).toBe(true);
    if (!deferred.ok) return;
    const rejected = transitionResearchDecision(deferred.value, "rejected", { kind: "user", actorId: "lead" }, deferred.value.version, "Outside scope", env.clock);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.value.transitions.map((item) => item.to)).toEqual(["proposed", "deferred", "rejected"]);
    expect(transitionResearchDecision(rejected.value, "accepted", { kind: "user", actorId: "lead" }, rejected.value.version, "forge", env.clock)).toMatchObject({ ok: false, error: { code: "invalid_decision_transition" } });
    expect(parseResearchDecision(rejected.value).ok).toBe(true);
  });

  it("prevents model, system, and import actors from accepting, rejecting, freezing, or unfreezing", () => {
    const env = environment();
    const created = createResearchDecision(input(), env);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    for (const actor of [
      { kind: "model", model: "forger" } as const,
      { kind: "system", component: "forger" } as const,
      { kind: "import", sourceSystem: "forger" } as const,
    ]) {
      expect(transitionResearchDecision(created.value, "accepted", actor, created.value.version, "forge", env.clock)).toMatchObject({ ok: false, error: { code: "user_decision_required" } });
    }
  });

  it("requires explicit user freeze and unfreeze with expected-version semantics", () => {
    const env = environment();
    const proposed = createResearchDecision(input(), env);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const accepted = transitionResearchDecision(proposed.value, "accepted", { kind: "user", actorId: "lead" }, proposed.value.version, "Accepted", env.clock);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const frozen = transitionResearchDecision(accepted.value, "frozen", { kind: "user", actorId: "lead" }, accepted.value.version, "Do not relitigate", env.clock);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(transitionResearchDecision(frozen.value, "accepted", { kind: "model", model: "forger" }, frozen.value.version, "unfreeze", env.clock)).toMatchObject({ ok: false, error: { code: "user_decision_required" } });
    expect(transitionResearchDecision(frozen.value, "accepted", { kind: "user", actorId: "lead" }, accepted.value.version, "stale", env.clock)).toMatchObject({ ok: false, error: { code: "version_conflict" } });
  });

  it("uses explicit supersede rather than last-write-wins and records both sides", () => {
    const env = environment();
    const original = createResearchDecision(input(), env);
    const replacement = createResearchDecision({ ...input(), projectId: original.ok ? original.value.projectId : input().projectId, statement: "Network materials may enter only a marked limitations note" }, env);
    expect(original.ok && replacement.ok).toBe(true);
    if (!original.ok || !replacement.ok) return;
    const accepted = transitionResearchDecision(original.value, "accepted", { kind: "user", actorId: "lead" }, original.value.version, "Accepted", env.clock);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const result = supersedeResearchDecision(accepted.value, replacement.value, { kind: "user", actorId: "lead" }, accepted.value.version, replacement.value.version, "Evidence boundary changed", env.clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.superseded.status).toBe("superseded");
    expect(result.value.superseded.supersededByDecisionId).toBe(result.value.replacement.id);
    expect(result.value.replacement.status).toBe("accepted");
    expect(result.value.replacement.supersedesDecisionId).toBe(result.value.superseded.id);
  });

  it("returns an applicable frozen project decision instead of allowing an opposite model proposal to replace it", () => {
    const env = environment();
    const created = createResearchDecision(input(), env);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const accepted = transitionResearchDecision(created.value, "accepted", { kind: "user", actorId: "lead" }, created.value.version, "Accepted", env.clock);
    if (!accepted.ok) return;
    const frozen = transitionResearchDecision(accepted.value, "frozen", { kind: "user", actorId: "lead" }, accepted.value.version, "Frozen", env.clock);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const opposite = createResearchDecision({ ...input(), projectId: frozen.value.projectId, statement: "Add platform network data to the introduction" }, env);
    expect(opposite.ok).toBe(true);
    if (!opposite.ok) return;
    const matches = queryActiveResearchDecisions([opposite.value, frozen.value], { projectId: frozen.value.projectId });
    expect(matches.ok).toBe(true);
    if (matches.ok) {
      expect(matches.value).toHaveLength(1);
      expect(matches.value[0].decision.id).toBe(frozen.value.id);
      expect(matches.value[0].priorityExplanation).toContain("project");
    }
  });

  it("does not let a narrow artifact decision erase a project decision and reconstructs historical state", () => {
    const env = environment("2026-08-19T04:00:00.000Z");
    const projectDecision = createResearchDecision(input(), env);
    expect(projectDecision.ok).toBe(true);
    if (!projectDecision.ok) return;
    const artifactId = env.idFactory.create("rart_");
    const narrow = createResearchDecision({ ...input(), projectId: projectDecision.value.projectId, scope: { kind: "artifact", artifactId }, statement: "Use a short note in this artifact" }, env);
    expect(narrow.ok).toBe(true);
    if (!narrow.ok) return;
    const acceptedProject = transitionResearchDecision(projectDecision.value, "accepted", { kind: "user", actorId: "lead" }, projectDecision.value.version, "accept", env.clock);
    const acceptedNarrow = transitionResearchDecision(narrow.value, "accepted", { kind: "user", actorId: "lead" }, narrow.value.version, "accept", env.clock);
    expect(acceptedProject.ok && acceptedNarrow.ok).toBe(true);
    if (!acceptedProject.ok || !acceptedNarrow.ok) return;
    const matches = queryActiveResearchDecisions([acceptedNarrow.value, acceptedProject.value], { projectId: projectDecision.value.projectId, artifactId });
    expect(matches.ok).toBe(true);
    if (matches.ok) expect(matches.value.map((item) => item.decision.id)).toEqual([acceptedNarrow.value.id, acceptedProject.value.id]);
    expect(getDecisionStateAt(acceptedProject.value, "2026-08-19T03:59:59.000Z")).toBeUndefined();
    expect(getDecisionStateAt(acceptedProject.value, "2026-08-19T04:00:00.000Z")).toBe("accepted");
  });
});
