import { expect, it } from "vitest";
import { openDatabase } from "@sestina/storage";
import {
  createResearchStore,
  readKernelSnapshot,
} from "@sestina/research-store";
import { parseArgumentClaim, parseMechanismLink } from "@sestina/research";
import {
  migrateKernelProject,
  openResearchDeliberationKernel,
} from "@sestina/core";
import { syntheticProject, USER, value } from "../factory.js";
import { ids, at } from "../kernel-fixtures.js";
import { session, resolveUser } from "../application-fixtures.js";
it("G4 canonical Evidence and both supported relation families commit together without elevating support", async () => {
  const f = await syntheticProject();
  f.core.close();
  const db = await openDatabase({ path: f.databasePath }),
    store = createResearchStore(db);
  const source = {
    actor: USER,
    authority: "user_recorded" as const,
    recordedAt: at,
  };
  const common = {
    projectId: f.projectId,
    artifactId: f.artifact.artifact.id,
    revisionId: f.artifact.revision.id,
    source,
    version: 1,
  };
  const a = value(
    parseArgumentClaim({
      ...common,
      id: ids.create("rclm_"),
      kind: "descriptive",
      statement: "Synthetic observation A",
    }),
  );
  const b = value(
    parseArgumentClaim({
      ...common,
      id: ids.create("rclm_"),
      kind: "mechanistic",
      statement: "Synthetic explanation B",
    }),
  );
  const m = value(
    parseMechanismLink({
      ...common,
      id: ids.create("rmec_"),
      fromClaimId: a.id,
      toClaimId: b.id,
      relation: "May explain",
      intermediateSteps: ["Unproven mechanism step"],
    }),
  );
  try {
    value(store.claims.create(a));
    value(store.claims.create(b));
    value(store.mechanismLinks.create(m));
  } finally {
    db.close();
  }
  await migrateKernelProject({ projectRoot: f.root });
  const kernel = await openResearchDeliberationKernel(f.root, { resolveUser });
  try {
    let r = kernel.createReview("Attach a bounded source", session);
    r = await kernel.skipAssessment(r.id, r.version, session);
    const payload = {
      kind: "add_evidence",
      evidence: {
        kind: "artifact_span",
        artifactId: f.artifact.artifact.id,
        revisionId: f.artifact.revision.id,
        contentVersionHash: f.artifact.revision.content.contentHash,
        summary: "Synthetic observation",
        state: "current",
        inferenceCapacity: "descriptive",
        provenance: {
          citation: "Synthetic local artifact",
          locator: "First observation",
        },
      },
      links: [
        { kind: "claim", claimId: a.id, role: "supports", status: "unproven" },
        {
          kind: "mechanism",
          mechanismLinkId: m.id,
          stepIndex: 0,
          status: "unproven",
        },
      ],
      reason: "User records the source",
    };
    const p = kernel.prepareEffect(r.id, r.version, payload, session),
      d = p.effectDraft!;
    const receipt = kernel.commitEffect(
      p.id,
      p.version,
      d.previewHash,
      d.authorityCommandId!,
      session,
    );
    expect(receipt.resultingObjects.map((o) => o.kind).sort()).toEqual([
      "claim_evidence_link",
      "evidence",
      "mechanism_evidence_link",
    ]);
    const state = readKernelSnapshot(kernel.database, f.projectId);
    for (const link of state.state.objects.filter((o) =>
      o.kind.endsWith("evidence_link"),
    ))
      expect(link.data.status).toBe("unproven");
    let next = kernel.createReview("Malformed relation", session);
    next = await kernel.skipAssessment(next.id, next.version, session);
    expect(() =>
      kernel.prepareEffect(
        next.id,
        next.version,
        {
          ...payload,
          evidence: { ...payload.evidence, summary: "Different observation" },
          links: [
            {
              kind: "mechanism",
              mechanismLinkId: m.id,
              stepIndex: 1,
              status: "unproven",
            },
          ],
        },
        session,
      ),
    ).toThrow("invalid_record");
    expect(readKernelSnapshot(kernel.database, f.projectId)).toEqual(state);
  } finally {
    kernel.close();
    await f.cleanup();
  }
});
