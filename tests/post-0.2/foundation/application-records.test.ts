import { it, expect } from "vitest";
import { parseKernelReview, parseKernelAssessment, kernelHash } from "@sestina/research";
import { draft, ids, at } from "../kernel-fixtures.js";

it("G4: a saved effect retains its exact payload and inspectable preview after decoding", () => {
  const review = draft(ids.create("rprj_"), 1);
  const preview = { payload: { kind: "record_only", outcome: "deferred", reason: "Await new material." }, baseProjectStateRevision: 1,
    objects: [], unchangedObjects: [], compensation: "Create a new Review; history is immutable.", affectedReviews: [], affectedManifests: [] };
  const effectDraft = { effectId: ids.create("rpev_"), effectKind: "record_only", previewHash: kernelHash(preview),
    baseProjectStateRevision: 1, objectVersions: [], payload: preview.payload, preview,
    authorityCommandId: ids.create("rpev_"), allocatedIds: [], preparedAt: at, actorId: "synthetic-owner" };
  expect(parseKernelReview({ ...review, effectDraft }).effectDraft).toEqual(effectDraft);
});

it("G5: protocol integrity fields survive independently without semantic promotion", () => {
  const assessment = { availability: "received", requestBound: false, schemaValidated: true, quotesLocated: false,
    claimFieldsParsed: true, semanticCorrectness: "unproven", publicSummary: "Binding is not valid.",
    envelope: { schemaVersion: "2.0.0", request_binding_valid: false, response_schema_valid: true,
      quoted_span_integrity_valid: false, provider_assessment_available: true } };
  expect(parseKernelAssessment(assessment)).toEqual(assessment);
});
