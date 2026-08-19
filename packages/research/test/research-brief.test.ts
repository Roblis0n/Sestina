import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  confirmBriefChangeProposal,
  createBriefChangeProposal,
  createResearchBrief,
  exportResearchBriefYaml,
  getActiveResearchBriefVersion,
  getResearchBriefVersion,
  parseResearchBrief,
  type ResearchBriefInput,
  type ResearchSource,
} from "../src/index.js";

const USER: ResearchSource = {
  actor: { kind: "user", actorId: "lead" },
  authority: "user_confirmed",
  recordedAt: "2026-08-19T02:00:00.000Z",
};
const MODEL: ResearchSource = {
  actor: { kind: "model", provider: "test", model: "proposal-model" },
  authority: "model_proposed",
  recordedAt: "2026-08-19T02:00:00.000Z",
};

function ports() {
  return {
    clock: new FixedClock("2026-08-19T02:30:00.000Z"),
    idFactory: new SequenceIdFactory(100),
  };
}

function validInput(ids = new SequenceIdFactory(500)): ResearchBriefInput {
  const artifactId = ids.create("rart_");
  return {
    projectId: ids.create("rprj_"),
    projectQuestion: "How does platform moderation shape participation?",
    currentStage: "analysis",
    currentTask: "Revise the interpretation section",
    targetArtifacts: [artifactId],
    fixedDecisions: [
      {
        id: ids.create("rbrf_"),
        statement: "Do not infer causality from cross-sectional data",
        scope: { target: { kind: "artifact", artifactId }, operations: ["rewrite"] },
      },
    ],
    allowedChanges: [
      { target: { kind: "heading", artifactId, heading: "Interpretation" }, operations: ["add", "rewrite", "citation_add"] },
    ],
    forbiddenChanges: [
      { target: { kind: "heading", artifactId, heading: "Methods" }, operations: ["rewrite", "data_replace"] },
    ],
    expectedDeltas: [
      {
        id: ids.create("rbrf_"),
        statement: "Add one bounded interpretation tied to the observed pattern",
        scope: { target: { kind: "heading", artifactId, heading: "Interpretation" }, operations: ["add"] },
      },
    ],
    evidenceBoundaries: [
      {
        id: ids.create("rbrf_"),
        scope: { target: { kind: "artifact", artifactId }, operations: ["rewrite"] },
        statement: "Do not claim causality",
        forbiddenInferenceKinds: ["causal"],
      },
    ],
    explicitNonGoals: ["Re-run data collection"],
    source: USER,
  };
}

describe("versioned Research Brief", () => {
  it("creates an immutable active v1 with structured scope and expected delta", () => {
    const result = createResearchBrief(validInput(), ports());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(1);
    const active = getActiveResearchBriefVersion(result.value);
    expect(active?.versionNumber).toBe(1);
    expect(active?.expectedDeltas).toHaveLength(1);
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active?.allowedChanges)).toBe(true);
  });

  it("rejects an active brief without a current task or expected delta", () => {
    const missingTask = { ...validInput(), currentTask: "" };
    expect(createResearchBrief(missingTask, ports())).toMatchObject({
      ok: false,
      error: { code: "invalid_research_brief" },
    });
    const missingDelta = { ...validInput(), expectedDeltas: [] };
    expect(createResearchBrief(missingDelta, ports())).toMatchObject({
      ok: false,
      error: { code: "invalid_research_brief" },
    });
  });

  it("allows an initial project-scoped brief before its first artifact is registered", () => {
    const input = validInput();
    const result = createResearchBrief({
      ...input,
      targetArtifacts: [],
      allowedChanges: [{ target: { kind: "project_path", relativePath: "paper/manuscript.md" }, operations: ["add"] }],
      expectedDeltas: [{
        id: new SequenceIdFactory(9800).create("rbrf_"),
        statement: "Create the first bounded manuscript artifact",
        scope: { target: { kind: "project_path", relativePath: "paper/manuscript.md" }, operations: ["add"] },
      }],
    }, ports());
    expect(result.ok).toBe(true);
  });

  it("rejects overlapping allowed and forbidden operations on the same normalized scope", () => {
    const input = validInput();
    const conflict = input.allowedChanges[0];
    expect(
      createResearchBrief(
        { ...input, forbiddenChanges: [conflict] },
        ports(),
      ),
    ).toMatchObject({ ok: false, error: { code: "scope_rule_conflict" } });
  });

  it("records a model scope expansion only as a proposal and leaves v1 active", () => {
    const environment = ports();
    const created = createResearchBrief(validInput(), environment);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const activeBefore = getActiveResearchBriefVersion(created.value);
    if (activeBefore === undefined) throw new Error("active brief missing");
    const proposal = createBriefChangeProposal(
      created.value,
      {
        changes: {
          allowedChanges: [
            ...activeBefore.allowedChanges,
            { target: { kind: "project_path", relativePath: "data/new.json" }, operations: ["data_replace"] },
          ],
        },
        reason: "The model wants broader access",
        source: MODEL,
      },
      environment,
    );
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(getActiveResearchBriefVersion(proposal.value.brief)?.id).toBe(activeBefore.id);
    expect(proposal.value.proposal.status).toBe("pending");
    expect(proposal.value.proposal.diffFields).toEqual(["allowedChanges"]);
    expect(Object.isFrozen(proposal.value.proposal)).toBe(true);
  });

  it("only a user can confirm a proposal, producing v2 while v1 remains readable", () => {
    const environment = ports();
    const created = createResearchBrief(validInput(), environment);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const activeV1 = getActiveResearchBriefVersion(created.value);
    if (activeV1 === undefined) throw new Error("active brief missing");
    const proposed = createBriefChangeProposal(
      created.value,
      { changes: { currentTask: "Tighten limitations" }, reason: "Change task", source: MODEL },
      environment,
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const modelAttempt = confirmBriefChangeProposal(
      proposed.value.brief,
      proposed.value.proposal.id,
      { kind: "model", model: "forger" },
      proposed.value.brief.version,
      environment,
    );
    expect(modelAttempt).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });

    const confirmed = confirmBriefChangeProposal(
      proposed.value.brief,
      proposed.value.proposal.id,
      { kind: "user", actorId: "lead" },
      proposed.value.brief.version,
      environment,
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(getActiveResearchBriefVersion(confirmed.value)?.versionNumber).toBe(2);
    expect(getActiveResearchBriefVersion(confirmed.value)?.currentTask).toBe("Tighten limitations");
    expect(getResearchBriefVersion(confirmed.value, activeV1.id)?.currentTask).toBe(activeV1.currentTask);
    expect(activeV1.versionNumber).toBe(1);
  });

  it("uses expected-version semantics and rejects forged persisted state", () => {
    const environment = ports();
    const created = createResearchBrief(validInput(), environment);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const forged = { ...created.value, currentVersionId: environment.idFactory.create("rbrf_") };
    expect(parseResearchBrief(forged)).toMatchObject({ ok: false, error: { code: "invalid_research_brief" } });
  });

  it("exports a deterministic readable YAML projection without making it authoritative", () => {
    const created = createResearchBrief(validInput(), ports());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const active = getActiveResearchBriefVersion(created.value);
    if (active === undefined) throw new Error("active brief missing");
    const first = exportResearchBriefYaml(active);
    const second = exportResearchBriefYaml(active);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value).toContain("projectQuestion:");
      expect(first.value).toContain("expectedDeltas:");
      expect(first.value).not.toContain("[object Object]");
    }
  });
});
