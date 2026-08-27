import { describe, expect, it } from "vitest";
import { DELIBERATION_COMPARISON_DIMENSION_IDS, SequenceIdFactory, stableResearchHash, type DeliberationParticipantSnapshot } from "@sestina/research";
import {
  compileDeliberationParticipantPrompt,
  createDeliberationContextManifest,
  createStableTextSpan,
  prepareDeliberationParticipantRequest,
  submitDeliberationParticipantAssessment,
  type DeliberationParticipantRequest,
  type DeliberationParticipantResponse,
} from "../src/index.js";

const ids = new SequenceIdFactory(80_000);
const projectId = ids.create("rprj_");
const roomId = ids.create("rdlr_");
const roundId = ids.create("rrnd_");
const artifactId = ids.create("rart_");
const revisionId = ids.create("rrev_");
const issueId = ids.create("riss_");
const TEXT = "The observational association is stable, but this design cannot establish causality or identify a mechanism.";

function hash(value: unknown): string {
  const result = stableResearchHash(value);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

const PARTICIPANTS: readonly [DeliberationParticipantSnapshot, DeliberationParticipantSnapshot] = [
  { id: ids.create("rpar_"), slot: "a", role: "independent_research_assessor", connectionId: "conn-a", providerId: "provider-a", family: "openai_compatible", model: "model-a", harnessId: "harness-a", runtimeIdentityHash: "a".repeat(64), endpointIdentityHash: "b".repeat(64), secretRefHash: "c".repeat(64), configGeneration: 1, locality: "local" },
  { id: ids.create("rpar_"), slot: "b", role: "independent_research_assessor", connectionId: "conn-b", providerId: "provider-b", family: "openai_compatible", model: "model-b", harnessId: "harness-b", runtimeIdentityHash: "d".repeat(64), endpointIdentityHash: "e".repeat(64), secretRefHash: "f".repeat(64), configGeneration: 2, locality: "external" },
];

function prepared(slot: "a" | "b"): DeliberationParticipantRequest {
  const participant = PARTICIPANTS[slot === "a" ? 0 : 1];
  const sourceBase = { kind: "research_issue" as const, objectId: issueId, objectVersion: 4, question: "Should the causal interpretation be retained?" };
  const allowed = { kind: "issue" as const, id: issueId, version: 4, fields: { status: "open", summary: "Causal interpretation remains disputed." } };
  const result = prepareDeliberationParticipantRequest({
    roomId,
    roundId,
    projectId,
    participant,
    source: { projectId, ...sourceBase, sourceHash: hash(sourceBase) },
    stateBindingHash: "1".repeat(64),
    question: sourceBase.question,
    comparisonDimensions: DELIBERATION_COMPARISON_DIMENSION_IDS.map((id) => ({ id, label: id.replaceAll("_", " ") })),
    frozenInput: { projectId, artifactId, revisionId, text: TEXT },
    allowedContext: [{ ...allowed, hash: hash(allowed) }],
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function response(request: DeliberationParticipantRequest): DeliberationParticipantResponse {
  const span = createStableTextSpan(request.context.frozenInput, 0, TEXT.length);
  if (!span.ok) throw new Error(span.error.code);
  return {
    schemaVersion: "1.0.0",
    protocolVersion: request.protocol.version,
    protocolHash: request.protocol.hash,
    promptVersion: request.prompt.version,
    promptHash: request.prompt.hash,
    schemaVersionHash: request.responseSchemaHash,
    rubricVersion: request.rubric.version,
    rubricHash: request.rubric.hash,
    roomId: request.roomId,
    roundId: request.roundId,
    projectId: request.projectId,
    participantId: request.participant.id,
    participantSlot: request.participant.slot,
    participantSnapshotHash: request.participantSnapshotHash,
    requestHash: request.requestHash,
    inputHash: request.context.frozenInput.normalizedTextHash,
    assessment: request.participant.slot === "a" ? "support" : "mixed",
    directAnswer: "Report only the association; causal identification remains unsupported.",
    dimensions: request.context.comparisonDimensions.map((item) => ({ dimensionId: item.id, position: "qualify", summary: `Qualified position for ${item.label}.`, evidenceSpanIds: ["span-1"] })),
    claims: [{ claimId: "claim-1", stance: "qualify", text: "The association can be reported with an explicit causal limitation.", evidenceSpanIds: ["span-1"] }],
    evidenceSpans: [{ spanId: "span-1", ...span.value }],
    assumptions: ["The bounded target is reporting language."],
    scope: "Interpretation of the frozen observational statement",
    counterexamples: ["A stable association can remain confounded."],
    alternativeExplanations: ["Residual confounding"],
    unknowns: ["The causal mechanism is unknown."],
    nextDiscriminatingEvidence: ["A credible identification design"],
    missingContext: ["No identification strategy is supplied."],
    uncertaintySources: ["Only the frozen room context was assessed."],
    publicRationale: "The text explicitly denies causal identification and a mechanism.",
    proposedNextStep: "Narrow the statement and request identification evidence before any causal claim.",
  };
}

describe("RI-50 strict mutually blind participant protocol", () => {
  it("builds two exact requests before dispatch with separate hashes and no peer output, session, tools, or authority", () => {
    const a = prepared("a");
    const b = prepared("b");
    expect(a.requestHash).not.toBe(b.requestHash);
    expect(a.constraints).toMatchObject({ tools: "none", roomContextOnly: true, comparisonForbidden: true, canResolveRoom: false, hiddenChainOfThoughtForbidden: true });
    expect(a.excludedFields).toEqual(expect.arrayContaining(["other_participant_output", "other_participant_private_context", "other_participant_session", "provider_raw_response", "hidden_chain_of_thought"]));
    expect(JSON.stringify(a)).not.toContain(PARTICIPANTS[1].connectionId);
    expect(JSON.stringify(b)).not.toContain(PARTICIPANTS[0].connectionId);
    expect(JSON.stringify(a)).not.toContain("adopt_a");
    const manifests = [createDeliberationContextManifest(a), createDeliberationContextManifest(b)] as const;
    expect(manifests[0]).toMatchObject({ ok: true, value: { participantSlot: "a", tools: "none", roomContextOnly: true } });
    expect(manifests[1]).toMatchObject({ ok: true, value: { participantSlot: "b", tools: "none", roomContextOnly: true } });
    if (manifests[0].ok && manifests[1].ok) expect(manifests[0].value.canonicalHash).not.toBe(manifests[1].value.canonicalHash);
  });

  it("compiles a fixed system instruction that treats all room context as untrusted data", () => {
    const compiled = compileDeliberationParticipantPrompt(prepared("a"));
    expect(compiled).toMatchObject({ ok: true, value: { messages: [{ role: "system" }, { role: "user" }] } });
    if (compiled.ok) {
      expect(compiled.value.systemInstruction).toContain("untrusted data");
      expect(compiled.value.systemInstruction).toContain("Do not compare");
      expect(compiled.value.systemInstruction).toContain("Do not reveal chain of thought");
    }
  });

  it("accepts one exact span-bound assessment and strips all transport/provider response material", () => {
    const request = prepared("a");
    const result = submitDeliberationParticipantAssessment(request, response(request));
    expect(result).toMatchObject({ ok: true, value: { roomId, roundId, participantId: request.participant.id, participantSlot: "a", assessment: "support", hashes: { requestHash: request.requestHash } } });
    if (result.ok) {
      expect(JSON.stringify(result.value)).not.toContain("raw_response");
      expect(result.value).not.toHaveProperty("provider");
      expect(result.value).not.toHaveProperty("authorityCommand");
    }
  });

  it.each([
    ["extra authority command", (value: DeliberationParticipantResponse) => ({ ...value, authorityCommand: "adopt_a" })],
    ["peer comparison", (value: DeliberationParticipantResponse) => ({ ...value, comparison: "Participant B is better" })],
    ["wrong request", (value: DeliberationParticipantResponse) => ({ ...value, requestHash: "0".repeat(64) })],
    ["wrong participant", (value: DeliberationParticipantResponse) => ({ ...value, participantId: PARTICIPANTS[1].id })],
    ["wrong runtime binding", (value: DeliberationParticipantResponse) => ({ ...value, participantSnapshotHash: "0".repeat(64) })],
    ["bad span", (value: DeliberationParticipantResponse) => ({ ...value, evidenceSpans: value.evidenceSpans.map((span) => ({ ...span, end: span.end + 9 })) })],
    ["duplicate span id", (value: DeliberationParticipantResponse) => ({ ...value, evidenceSpans: [value.evidenceSpans[0], value.evidenceSpans[0]] })],
    ["unknown assessment", (value: DeliberationParticipantResponse) => ({ ...value, assessment: "winner" })],
    ["missing comparison dimension", (value: DeliberationParticipantResponse) => ({ ...value, dimensions: value.dimensions.slice(1) })],
    ["duplicate comparison dimension", (value: DeliberationParticipantResponse) => ({ ...value, dimensions: value.dimensions.map((item, index) => index === 1 ? { ...item, dimensionId: value.dimensions.at(0)?.dimensionId ?? "direct_question_fit" } : item) })],
    ["invalid comparison position", (value: DeliberationParticipantResponse) => ({ ...value, dimensions: value.dimensions.map((item, index) => index === 0 ? { ...item, position: "winner" } : item) })],
    ["forged input", (value: DeliberationParticipantResponse) => ({ ...value, inputHash: "0".repeat(64) })],
  ])("rejects %s atomically", (_name, mutate) => {
    const request = prepared("a");
    const before = structuredClone(request);
    expect(submitDeliberationParticipantAssessment(request, mutate(response(request)))).toMatchObject({ ok: false });
    expect(request).toEqual(before);
  });

  it("requires missing context for insufficient_context and rejects Markdown-wrapped or partial JSON", () => {
    const request = prepared("b");
    const insufficient = { ...response(request), assessment: "insufficient_context" as const, dimensions: request.context.comparisonDimensions.map((item) => ({ dimensionId: item.id, position: "not_addressed" as const, summary: "Insufficient context.", evidenceSpanIds: [] })), evidenceSpans: [], claims: [], missingContext: ["The identification design is absent."] };
    expect(submitDeliberationParticipantAssessment(request, insufficient)).toMatchObject({ ok: true, value: { assessment: "insufficient_context" } });
    expect(submitDeliberationParticipantAssessment(request, "{\"schemaVersion\":\"1.0.0\"")).toMatchObject({ ok: false, error: { code: "invalid_json" } });
    expect(submitDeliberationParticipantAssessment(request, `\`\`\`json\n${JSON.stringify(response(request))}\n\`\`\``)).toMatchObject({ ok: false, error: { code: "invalid_json" } });
  });
});
