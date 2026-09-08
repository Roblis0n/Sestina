import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, withTransaction } from "@sestina/storage";
import { createResearchStore } from "@sestina/research-store";
import {
  SestinaCore,
  migrateKernelProject,
  openResearchDeliberationKernel,
} from "@sestina/core";
import {
  createResearchBrief,
  createResearchDecision,
  createResearchIssue,
  createProjectWorkingMemoryCandidate,
  createResearchRoomReceipt,
  FixedClock,
  SequenceIdFactory,
} from "@sestina/research";
import {
  makeScenario,
  USER_SOURCE,
} from "../../packages/research-store/test/fixtures.js";
import { value, USER } from "./factory.js";
import { session, resolveUser } from "./application-fixtures.js";

/** New deterministic load corpus, never used as an immutable old-release compatibility fixture. */
export async function workspaceVolumeFixture() {
  const seed = 920000,
    s = makeScenario(seed),
    clock = new FixedClock("2026-09-08T00:00:00.000Z"),
    idFactory = new SequenceIdFactory(seed + 1000),
    ports = { clock, idFactory };
  const root = await mkdtemp(join(tmpdir(), "sestina-g8-volume-"));
  await mkdir(join(root, ".sestina"));
  const db = await openDatabase({ path: join(root, ".sestina/state.sqlite") }),
    store = createResearchStore(db);
  value(store.projects.create(s.project));
  value(store.artifacts.create(s.emptyArtifact));
  value(store.revisions.append(s.revision1));
  const brief = value(
    createResearchBrief(
      { ...s.brief.versions[0]!, projectId: s.project.id, source: USER_SOURCE },
      ports,
    ),
  );
  value(store.briefs.create(brief));
  const core = new SestinaCore(db, clock, idFactory);
  const prepared = value(
    core.prepareResearchRoomReview({
      projectId: s.project.id,
      suggestion: "Synthetic historical reference only",
      evidenceClass: "synthetic_fixture",
      countsAsExternalEvidence: false,
    }),
  );
  const analyzed = value(
    await core.analyzeResearchRoomSuggestion({
      reviewId: prepared.reviewId,
      confirmationNonce: prepared.confirmationNonce,
      manifestHash: prepared.manifestHash,
    }),
  );
  const template = value(
    core.commitResearchRoomDisposition({
      projectId: s.project.id,
      reviewId: analyzed.reviewId,
      authorityNonce: analyzed.authorityNonce,
      expectedStateBinding: analyzed.stateBinding,
      disposition: "deferred",
      reason: "Synthetic history template",
      actor: USER,
    }),
  );
  withTransaction(db, () => {
    for (let i = 1; i < 1000; i++)
      value(
        store.roomReceipts.create(
          value(
            createResearchRoomReceipt(
              { ...template, reviewId: idFactory.create("rrvw_"), actor: USER },
              ports,
            ),
          ),
        ),
      );
    const base = {
      projectId: s.project.id,
      artifactId: s.emptyArtifact.id,
      revisionId: s.revision1.id,
      source: USER_SOURCE,
      version: 1,
    };
    const evidence = {
      ...base,
      id: idFactory.create("revd_"),
      kind: "artifact_span" as const,
      summary: "Synthetic associational observation",
      state: "current" as const,
      inferenceCapacity: "associational" as const,
      contentVersionHash: s.revision1.content.contentHash,
    };
    value(store.argumentEvidence.create(evidence));
    for (let i = 0; i < 500; i++) {
      const claim = {
        ...base,
        id: idFactory.create("rclm_"),
        kind: "descriptive" as const,
        statement: `Synthetic claim ${i}`,
      };
      value(store.claims.create(claim));
      value(
        store.claimEvidenceLinks.create({
          projectId: s.project.id,
          claimId: claim.id,
          evidenceId: evidence.id,
          role: "supports",
          status: "unproven",
          source: USER_SOURCE,
          version: 1,
        }),
      );
    }
    for (let i = 0; i < 200; i++)
      value(
        store.issues.create(
          value(
            createResearchIssue(
              {
                ...s.issue,
                projectId: s.project.id,
                summary: `Synthetic open issue ${i}`,
                rationaleConcepts: [`bounded claim ${i}`],
                sourceArtifactId: s.emptyArtifact.id,
                sourceRevisionId: s.revision1.id,
                lineageRootRevisionId: s.revision1.id,
                sourceRevisionContentHash: s.revision1.content.contentHash,
              },
              ports,
            ),
          ),
        ),
      );
    for (let i = 0; i < 300; i++)
      value(
        store.decisions.create(
          value(
            createResearchDecision(
              {
                ...s.decision,
                projectId: s.project.id,
                statement: `Synthetic decision ${i}`,
                effectiveBriefVersionId: brief.currentVersionId,
                source: USER_SOURCE,
              },
              ports,
            ),
          ),
        ),
      );
    for (let i = 0; i < 50; i++)
      value(
        store.workingMemory.create(
          value(
            createProjectWorkingMemoryCandidate(
              {
                projectId: s.project.id,
                kind: "working_hint",
                content: { text: `Synthetic context ${i}` },
                source: { kind: "direct_user", actorId: USER.actorId },
                retention: { policy: "until_unpinned" },
                sensitivity: "project_private",
                outboundPolicy: "never_send",
                publicReason: "Synthetic context coverage",
                actor: USER,
              },
              ports,
            ),
          ),
        ),
      );
  });
  value(
    core.editBrief({
      ...brief.versions[0]!,
      projectId: s.project.id,
      projectQuestion: "Synthetic English research question. ".repeat(3000),
      currentTask: "合成中文研究任务，保留证据与推断边界。".repeat(2300),
      actor: USER,
    }),
  );
  await writeFile(
    join(root, ".sestina/research-brief.yaml"),
    value(core.getActiveBriefProjection(s.project.id))!.yaml,
  );
  core.close();
  await migrateKernelProject({ projectRoot: root });
  const kernel = await openResearchDeliberationKernel(root, {
    clock,
    idFactory,
    resolveUser,
  });
  for (let i = 0; i < 100; i++)
    kernel.createReview(`Synthetic pending review ${i} 待核对`, session);
  return {
    root,
    kernel,
    projectId: s.project.id,
    seed,
    async cleanup() {
      kernel.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
