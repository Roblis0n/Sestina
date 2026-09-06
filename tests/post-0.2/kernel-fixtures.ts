import { SequenceIdFactory, FixedClock, createResearchDecision, kernelBytesHash, kernelHash, manifestIdentity, type KernelCanonicalCommand, type KernelEffectKind, type KernelManifest, type KernelObjectRef, type KernelReview, type KernelUnitOfWork } from "@sestina/research";
import { readKernelSnapshot } from "@sestina/research-store";
import type { StorageDatabase } from "@sestina/storage";
import { USER, value } from "./factory.js";

export const ids = new SequenceIdFactory(200_000);
export const at = "2026-09-06T08:00:00.000Z";
export const capability = Object.freeze({ syntheticLocalSession: true });
export function draft(projectId: string, revision: number): KernelReview {
  const suggestion = "Synthetic bounded research change.";
  return { schemaVersion: "2.0.0", id: ids.create("rrvw_"), projectId, source: { kind: "user", id: null }, suggestion, suggestionHash: kernelBytesHash(suggestion), requestedTarget: null, status: "draft", baseProjectStateRevision: revision, manifestId: null, attemptIds: [], effectDraft: null, terminalOutcome: null, staleReason: null, version: 1, createdAt: at, updatedAt: at };
}
export function prepare(uow: KernelUnitOfWork, projectId: string, effectKind: KernelEffectKind = "record_only", objectVersions: readonly KernelObjectRef[] = [], provider = false, preparedOnly = false) {
  const result = uow.workflow((repos) => {
    let review = repos.reviews.create(draft(projectId, repos.heads.get(projectId).revision));
    const body = provider ? "{\"synthetic\":true}" : null;
    const manifestBase: Omit<KernelManifest, "identityHash"> = { schemaVersion: "2.0.0", id: ids.create("rman_"), projectId, reviewId: review.id, baseProjectStateRevision: review.baseProjectStateRevision,
      contextProjectionPolicyVersion: "1.0.0", contextProjectionSchemaVersion: "1.0.0", contextProjectionHash: kernelHash({ synthetic: true }),
      provider: provider ? { id: "synthetic", model: "fixture", family: "openai_compatible", locality: "local", origin: "http://127.0.0.1:1", configGeneration: 1, serializerVersion: "1.0.0" } : null,
      exactRequestBody: body, exactRequestHash: body ? kernelBytesHash(body) : null, exactRequestBytes: body ? Buffer.byteLength(body) : 0, selectedMemory: [], excludedFields: ["unselected_memory"], limitations: ["Synthetic, semantic correctness unproven."], status: "prepared", version: 1, createdAt: at, updatedAt: at };
    let manifest = repos.manifests.create({ ...manifestBase, identityHash: manifestIdentity(manifestBase) });
    review = repos.reviews.compareAndSwap({ ...review, manifestId: manifest.id, status: "manifest_prepared", version: 2 }, 1);
    if (preparedOnly) return { review, manifest };
    manifest = repos.manifests.compareAndSwap({ ...manifest, status: "confirmed", version: 2 }, 1);
    review = repos.reviews.compareAndSwap({ ...review, status: "manifest_confirmed", version: 3 }, 2);
    review = repos.reviews.compareAndSwap({ ...review, effectDraft: { effectId: `effect-${ids.create("rpev_")}`, effectKind, baseProjectStateRevision: review.baseProjectStateRevision, previewHash: kernelHash({ effectKind, objectVersions }), objectVersions }, version: 4 }, 3);
    return { review, manifest };
  });
  const prepared = value(result);
  const command: KernelCanonicalCommand = { projectId, authorityCommandId: `command-${ids.create("rpev_")}`, reviewId: prepared.review.id, expectedReviewVersion: prepared.review.version, expectedProjectStateRevision: prepared.review.baseProjectStateRevision,
    effectId: prepared.review.effectDraft?.effectId ?? "unprepared", effectKind, previewHash: prepared.review.effectDraft?.previewHash ?? kernelHash({ preparedOnly: true }), objectVersions, actor: USER, authorityCapability: capability, publicReason: "Synthetic user approval of the exact change.", receiptId: ids.create("rrcp_"), eventId: ids.create("rpev_"), createdAt: at };
  return { ...prepared, command };
}
export function decision(db: StorageDatabase, projectId: string) {
  const brief = readKernelSnapshot(db, projectId).state.objects.find((o) => o.kind === "brief")!;
  return value(createResearchDecision({ projectId, statement: `Synthetic decision ${ids.create("rdec_")}`, scope: { kind: "project" }, rationale: "Synthetic source-bound choice.", effectiveBriefVersionId: String(brief.data.currentVersionId), reopenConditions: ["New evidence changes the boundary."], source: { actor: USER, authority: "user_recorded", recordedAt: at } }, { clock: new FixedClock(at), idFactory: ids }));
}
