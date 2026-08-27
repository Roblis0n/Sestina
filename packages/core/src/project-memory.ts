import { randomBytes } from "node:crypto";
import {
  computeResumeChanges,
  confirmProjectWorkingMemory,
  createProjectWorkingMemoryCandidate,
  createResumeCheckpoint,
  editProjectWorkingMemory,
  expireProjectWorkingMemory,
  forgetProjectWorkingMemory,
  getActiveResearchBriefVersion,
  isProjectWorkingMemoryRecallEligible,
  markProjectWorkingMemorySourceStale,
  renewProjectWorkingMemory,
  retireProjectWorkingMemory,
  stableResearchHash,
  type Clock,
  type EntityVersion,
  type IdFactory,
  type LiveProjectWorkingMemory,
  type ProjectWorkingMemory,
  type ProjectWorkingMemoryContent,
  type ProjectWorkingMemoryKind,
  type ProjectWorkingMemoryObjectKind,
  type ProjectWorkingMemoryOutboundPolicy,
  type ProjectWorkingMemoryRetention,
  type ProjectWorkingMemorySensitivity,
  type ProjectWorkingMemorySource,
  type ResearchActor,
  type ResearchPageRequest,
  type ResumeAuthorityBinding,
  type ResumeCheckpoint,
  type ResumeChanges,
  type ResumeCurrentSnapshot,
} from "@sestina/research";
import type { ResearchStore } from "@sestina/research-store";
import { coreErr, coreOk, fromDomain, type CoreResult } from "./errors.js";

const PAGE_LIMIT = 200;
const RESUME_MEMORY_LIMIT = 400;
const MANIFEST_MAX_ITEMS = 64;
const MANIFEST_TTL_MS = 15 * 60 * 1_000;

export type ProjectMemoryManifestExclusionReason =
  | "not_selected"
  | "candidate_not_confirmed"
  | "stale_source"
  | "expired"
  | "retired"
  | "forgotten"
  | "never_send"
  | "sensitivity_forbids_send";

export interface ProjectMemoryProviderBinding {
  readonly id: string;
  readonly kind: "none" | "deterministic_fixture" | "local" | "external";
  readonly configHash: string;
  readonly networkRequired: boolean;
}

export interface ProjectMemoryManifestPayloadItem {
  readonly itemId: string;
  readonly kind: ProjectWorkingMemoryKind;
  readonly version: number;
  readonly contentHash: string;
  readonly content: ProjectWorkingMemoryContent;
  readonly source: ProjectWorkingMemorySource;
  readonly sensitivity: ProjectWorkingMemorySensitivity;
}

export interface ProjectMemoryManifestProjection {
  readonly schemaVersion: "1.0.0";
  readonly manifestId: string;
  readonly projectId: string;
  readonly authorityClass: "explicit_context_manifest_non_authoritative";
  readonly status: "previewed" | "confirmed" | "consumed";
  readonly provider: ProjectMemoryProviderBinding;
  readonly projectStateHash: string;
  readonly included: readonly {
    readonly itemId: string;
    readonly kind: ProjectWorkingMemoryKind;
    readonly version: number;
    readonly contentHash: string;
    readonly source: ProjectWorkingMemorySource;
    readonly state: "active";
    readonly sensitivity: ProjectWorkingMemorySensitivity;
    readonly outboundPolicy: "explicit_manifest_only";
    readonly contentBytes: number;
    readonly stale: false;
    readonly willLeaveDevice: boolean;
  }[];
  readonly excluded: readonly {
    readonly itemId: string;
    readonly state: ProjectWorkingMemory["state"];
    readonly reason: ProjectMemoryManifestExclusionReason;
  }[];
  readonly providerPayload: {
    readonly schemaVersion: "1.0.0";
    readonly projectId: string;
    readonly authority: "working_memory_context_only_non_authoritative";
    readonly items: readonly ProjectMemoryManifestPayloadItem[];
  };
  readonly manifestHash: string;
  readonly confirmationNonce: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly version: number;
}

export interface ProjectMemoryItemProjection {
  readonly id: string;
  readonly projectId: string;
  readonly authorityClass: "working_memory_non_authoritative";
  readonly state: ProjectWorkingMemory["state"];
  readonly version: number;
  readonly recallEligible: boolean;
  readonly manifestEligible: boolean;
  readonly content?: ProjectWorkingMemoryContent;
  readonly contentHash?: string;
  readonly kind?: ProjectWorkingMemoryKind;
  readonly source?: ProjectWorkingMemorySource;
  readonly retention?: ProjectWorkingMemoryRetention;
  readonly sensitivity?: ProjectWorkingMemorySensitivity;
  readonly outboundPolicy?: ProjectWorkingMemoryOutboundPolicy;
  readonly semanticConflict?: "semantic_conflict_unchecked";
  readonly staleReason?: LiveProjectWorkingMemory["staleReason"];
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly confirmedAt?: string;
  readonly expiredAt?: string;
  readonly retiredAt?: string;
  readonly forgottenAt?: string;
  readonly tombstone?: "irreversible_forget_recorded";
  readonly transitions?: LiveProjectWorkingMemory["transitions"];
}

export interface ProjectMemoryProjection {
  readonly schemaVersion: "1.0.0";
  readonly projectId: string;
  readonly projectState: {
    readonly authorityClass: "kernel_authoritative_projection";
    readonly projectVersion: number;
    readonly projectQuestion?: string;
    readonly currentTask?: string;
    readonly currentBrief?: { readonly id: string; readonly version: number };
    readonly currentEpisode?: { readonly id: string; readonly status: string; readonly version: number };
    readonly activeDecisions: readonly { readonly id: string; readonly statement: string; readonly status: string; readonly version: number }[];
    readonly openIssues: readonly { readonly id: string; readonly summary: string; readonly status: string; readonly version: number }[];
    readonly activeAppeals: readonly { readonly id: string; readonly status: string; readonly version: number }[];
    readonly activeDeliberations: readonly { readonly id: string; readonly status: string; readonly version: number }[];
    readonly recentReceipt?: { readonly id: string; readonly status: string; readonly version: number };
    readonly unproven: readonly string[];
    readonly stateHash: string;
  };
  readonly workingMemory: {
    readonly authorityClass: "working_memory_non_authoritative";
    readonly items: readonly ProjectMemoryItemProjection[];
    readonly activeCount: number;
    readonly nextCursor?: string;
    readonly semanticConflict: "semantic_conflict_unchecked";
    readonly defaultOutboundPolicy: "never_send";
  };
  readonly resume: {
    readonly authorityClass: "resume_checkpoint_non_authoritative";
    readonly checkpoint?: ResumeCheckpoint;
    readonly changes?: ResumeChanges;
    readonly reviewed: boolean;
  };
  readonly attention: readonly {
    readonly id: string;
    readonly kind: "memory_candidate" | "memory_stale" | "memory_expired" | "memory_expiring";
    readonly title: string;
    readonly reason: string;
    readonly href: "/project/memory";
    readonly severity: "normal" | "high";
  }[];
}

interface CurrentProjectState {
  readonly projection: ProjectMemoryProjection["projectState"];
  readonly snapshot: ResumeCurrentSnapshot;
  readonly currentEpisodeId?: string;
}

type ManifestEntry = ProjectMemoryManifestProjection;

function hash(value: unknown): CoreResult<string> {
  return fromDomain(stableResearchHash(value));
}

function currentTime(clock: Clock): CoreResult<string> {
  try {
    const value = clock.now();
    return value instanceof Date && Number.isFinite(value.getTime())
      ? coreOk(value.toISOString())
      : coreErr("infrastructure_failure");
  } catch {
    return coreErr("infrastructure_failure");
  }
}

function validSha(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  const a = stableResearchHash(left);
  const b = stableResearchHash(right);
  return a.ok && b.ok && a.value === b.value;
}

function found<T>(result: CoreResult<T | undefined>): CoreResult<T> {
  if (!result.ok) return result;
  return result.value === undefined ? coreErr("not_found") : coreOk(result.value);
}

function stateExclusion(item: ProjectWorkingMemory, selected: boolean, provider: ProjectMemoryProviderBinding): ProjectMemoryManifestExclusionReason | undefined {
  if (item.state === "candidate") return "candidate_not_confirmed";
  if (item.state === "stale") return "stale_source";
  if (item.state === "expired") return "expired";
  if (item.state === "retired") return "retired";
  if (item.state === "forgotten") return "forgotten";
  if (item.outboundPolicy === "never_send") return "never_send";
  if (item.sensitivity === "secret_never_send" || item.sensitivity === "sensitive" || provider.kind === "external" && item.sensitivity !== "public") return "sensitivity_forbids_send";
  if (!selected) return "not_selected";
  return undefined;
}

export class ProjectMemoryService {
  readonly #manifests = new Map<string, ManifestEntry>();

  constructor(
    private readonly store: ResearchStore,
    private readonly clock: Clock,
    private readonly idFactory: IdFactory,
  ) {}

  createCandidate(input: {
    readonly projectId: string;
    readonly kind: ProjectWorkingMemoryKind;
    readonly content: ProjectWorkingMemoryContent;
    readonly retention?: ProjectWorkingMemoryRetention;
    readonly sensitivity: ProjectWorkingMemorySensitivity;
    readonly outboundPolicy: ProjectWorkingMemoryOutboundPolicy;
    readonly supersedesItemId?: string;
    readonly publicReason: string;
    readonly actor: ResearchActor;
  }): CoreResult<LiveProjectWorkingMemory> {
    const project = this.store.projects.getById(input.projectId);
    if (!project.ok) return fromDomain(project);
    if (project.value === undefined) return coreErr("not_found");
    const retention = input.retention ?? this.defaultRetention(input.projectId, input.kind);
    if (retention === undefined) return coreErr("state_conflict");
    const candidate = createProjectWorkingMemoryCandidate({
      ...input,
      retention,
      source: { kind: "direct_user", actorId: input.actor.kind === "user" ? input.actor.actorId : "" },
    }, this.ports);
    return candidate.ok ? fromDomain(this.store.workingMemory.create(candidate.value)) as CoreResult<LiveProjectWorkingMemory> : fromDomain(candidate);
  }

  createPinnedCandidate(input: {
    readonly projectId: string;
    readonly objectKind: ProjectWorkingMemoryObjectKind;
    readonly objectId: string;
    readonly kind: ProjectWorkingMemoryKind;
    readonly content: ProjectWorkingMemoryContent;
    readonly retention?: ProjectWorkingMemoryRetention;
    readonly sensitivity: ProjectWorkingMemorySensitivity;
    readonly outboundPolicy: ProjectWorkingMemoryOutboundPolicy;
    readonly publicReason: string;
    readonly actor: ResearchActor;
  }): CoreResult<LiveProjectWorkingMemory> {
    if (input.actor.kind !== "user") return coreErr("user_confirmation_required");
    const object = this.resolveProjectObject(input.projectId, input.objectKind, input.objectId);
    if (!object.ok) return object;
    const retention = input.retention ?? this.defaultRetention(input.projectId, input.kind);
    if (retention === undefined) return coreErr("state_conflict");
    const candidate = createProjectWorkingMemoryCandidate({
      projectId: input.projectId,
      kind: input.kind,
      content: input.content,
      source: {
        kind: "project_object",
        objectKind: input.objectKind,
        objectId: input.objectId,
        objectVersion: object.value.version,
        contentFingerprint: object.value.fingerprint,
      },
      retention,
      sensitivity: input.sensitivity,
      outboundPolicy: input.outboundPolicy,
      publicReason: input.publicReason,
      actor: input.actor,
    }, this.ports);
    return candidate.ok ? fromDomain(this.store.workingMemory.create(candidate.value)) as CoreResult<LiveProjectWorkingMemory> : fromDomain(candidate);
  }

  confirm(input: { readonly projectId: string; readonly itemId: string; readonly expectedVersion: number; readonly publicReason: string; readonly actor: ResearchActor }): CoreResult<LiveProjectWorkingMemory> {
    const current = this.requireItem(input.projectId, input.itemId); if (!current.ok) return current;
    const changed = confirmProjectWorkingMemory(current.value, input, this.ports);
    return changed.ok ? fromDomain(this.store.workingMemory.compareAndSwap(changed.value, input.expectedVersion as EntityVersion)) as CoreResult<LiveProjectWorkingMemory> : fromDomain(changed);
  }

  edit(input: { readonly projectId: string; readonly itemId: string; readonly expectedVersion: number; readonly content: ProjectWorkingMemoryContent; readonly retention: ProjectWorkingMemoryRetention; readonly sensitivity: ProjectWorkingMemorySensitivity; readonly outboundPolicy: ProjectWorkingMemoryOutboundPolicy; readonly publicReason: string; readonly actor: ResearchActor }): CoreResult<LiveProjectWorkingMemory> {
    const current = this.requireItem(input.projectId, input.itemId); if (!current.ok) return current;
    let source: ProjectWorkingMemorySource | undefined;
    if (current.value.state !== "forgotten" && current.value.source.kind === "project_object") {
      const object = this.resolveProjectObject(input.projectId, current.value.source.objectKind, current.value.source.objectId);
      if (!object.ok) return object;
      source = { ...current.value.source, objectVersion: object.value.version, contentFingerprint: object.value.fingerprint };
    }
    const changed = editProjectWorkingMemory(current.value, { ...input, ...(source ? { source } : {}) }, this.ports);
    return changed.ok ? fromDomain(this.store.workingMemory.compareAndSwap(changed.value, input.expectedVersion as EntityVersion)) as CoreResult<LiveProjectWorkingMemory> : fromDomain(changed);
  }

  renew(input: { readonly projectId: string; readonly itemId: string; readonly expectedVersion: number; readonly retention: ProjectWorkingMemoryRetention; readonly publicReason: string; readonly actor: ResearchActor }): CoreResult<LiveProjectWorkingMemory> {
    const current = this.requireItem(input.projectId, input.itemId); if (!current.ok) return current;
    const changed = renewProjectWorkingMemory(current.value, input, this.ports);
    return changed.ok ? fromDomain(this.store.workingMemory.compareAndSwap(changed.value, input.expectedVersion as EntityVersion)) as CoreResult<LiveProjectWorkingMemory> : fromDomain(changed);
  }

  retire(input: { readonly projectId: string; readonly itemId: string; readonly expectedVersion: number; readonly publicReason: string; readonly actor: ResearchActor }): CoreResult<LiveProjectWorkingMemory> {
    const current = this.requireItem(input.projectId, input.itemId); if (!current.ok) return current;
    const changed = retireProjectWorkingMemory(current.value, input, this.ports);
    return changed.ok ? fromDomain(this.store.workingMemory.compareAndSwap(changed.value, input.expectedVersion as EntityVersion)) as CoreResult<LiveProjectWorkingMemory> : fromDomain(changed);
  }

  forget(input: { readonly projectId: string; readonly itemId: string; readonly expectedVersion: number; readonly confirmation: string; readonly publicReason: "user_requested_irreversible_forget"; readonly actor: ResearchActor }): CoreResult<ProjectWorkingMemory> {
    const current = this.requireItem(input.projectId, input.itemId); if (!current.ok) return current;
    const changed = forgetProjectWorkingMemory(current.value, input, this.ports);
    if (!changed.ok) return fromDomain(changed);
    const persisted = fromDomain(this.store.workingMemory.compareAndSwap(changed.value, input.expectedVersion as EntityVersion));
    if (!persisted.ok) return persisted;
    for (const [id, manifest] of this.#manifests) {
      if (manifest.projectId === input.projectId && manifest.included.some((item) => item.itemId === input.itemId)) this.#manifests.delete(id);
    }
    return persisted;
  }

  projection(projectId: string, page: ResearchPageRequest): CoreResult<ProjectMemoryProjection> {
    const reconciled = this.reconcile(projectId); if (!reconciled.ok) return reconciled;
    const state = this.currentProjectState(projectId); if (!state.ok) return state;
    const list = fromDomain(this.store.workingMemory.listByProject(projectId, page)); if (!list.ok) return list;
    const all = this.readAllMemory(projectId); if (!all.ok) return all;
    const checkpoint = fromDomain(this.store.resumeCheckpoints.getLatest(projectId)); if (!checkpoint.ok) return checkpoint;
    const changes = checkpoint.value === undefined ? undefined : fromDomain(computeResumeChanges(checkpoint.value, state.value.snapshot));
    if (changes !== undefined && !changes.ok) return changes;
    const now = currentTime(this.clock); if (!now.ok) return now;
    const projected = list.value.items.map((item) => this.projectItem(item, new Date(now.value)));
    const attention = all.value.flatMap((item) => this.attentionFor(item, new Date(now.value)));
    return coreOk(Object.freeze({
      schemaVersion: "1.0.0" as const,
      projectId,
      projectState: state.value.projection,
      workingMemory: Object.freeze({
        authorityClass: "working_memory_non_authoritative" as const,
        items: Object.freeze(projected),
        activeCount: all.value.filter((item) => item.state === "active").length,
        ...(list.value.nextCursor ? { nextCursor: list.value.nextCursor } : {}),
        semanticConflict: "semantic_conflict_unchecked" as const,
        defaultOutboundPolicy: "never_send" as const,
      }),
      resume: Object.freeze({
        authorityClass: "resume_checkpoint_non_authoritative" as const,
        ...(checkpoint.value ? { checkpoint: checkpoint.value } : {}),
        ...(changes?.ok ? { changes: changes.value } : {}),
        reviewed: checkpoint.value !== undefined,
      }),
      attention: Object.freeze(attention),
    }));
  }

  reviewResume(input: { readonly projectId: string; readonly publicReason: string; readonly actor: ResearchActor }): CoreResult<ResumeCheckpoint> {
    const reconciled = this.reconcile(input.projectId); if (!reconciled.ok) return reconciled;
    const state = this.currentProjectState(input.projectId); if (!state.ok) return state;
    const checkpoint = createResumeCheckpoint({
      projectId: input.projectId,
      projectVersion: state.value.snapshot.projectVersion,
      authorityBindings: state.value.snapshot.authorityBindings,
      memoryBindings: state.value.snapshot.memoryBindings,
      actor: input.actor,
      publicReason: input.publicReason,
    }, this.ports);
    return checkpoint.ok ? fromDomain(this.store.resumeCheckpoints.append(checkpoint.value)) : fromDomain(checkpoint);
  }

  prepareManifest(input: { readonly projectId: string; readonly selectedItemIds: readonly string[]; readonly provider: ProjectMemoryProviderBinding; readonly actor: ResearchActor }): CoreResult<ProjectMemoryManifestProjection> {
    if (input.actor.kind !== "user") return coreErr("user_confirmation_required");
    if (!this.validProvider(input.provider) || input.selectedItemIds.length > MANIFEST_MAX_ITEMS || new Set(input.selectedItemIds).size !== input.selectedItemIds.length) return coreErr("invalid_input");
    const reconciled = this.reconcile(input.projectId); if (!reconciled.ok) return reconciled;
    const state = this.currentProjectState(input.projectId); if (!state.ok) return state;
    const all = this.readAllMemory(input.projectId); if (!all.ok) return all;
    for (const id of input.selectedItemIds) {
      if (!all.value.some((item) => item.id === id)) return coreErr("invalid_input");
    }
    const included: ProjectMemoryManifestProjection["included"][number][] = [];
    const excluded: ProjectMemoryManifestProjection["excluded"][number][] = [];
    const payloadItems: ProjectMemoryManifestPayloadItem[] = [];
    for (const item of all.value) {
      const reason = stateExclusion(item, input.selectedItemIds.includes(item.id), input.provider);
      if (reason !== undefined) {
        excluded.push(Object.freeze({ itemId: item.id, state: item.state, reason }));
        continue;
      }
      if (item.state !== "active") return coreErr("infrastructure_failure");
      const contentBytes = Buffer.byteLength(JSON.stringify(item.content), "utf8");
      included.push(Object.freeze({
        itemId: item.id,
        kind: item.kind,
        version: item.version,
        contentHash: item.contentHash,
        source: item.source,
        state: "active" as const,
        sensitivity: item.sensitivity,
        outboundPolicy: "explicit_manifest_only" as const,
        contentBytes,
        stale: false as const,
        willLeaveDevice: input.provider.networkRequired,
      }));
      payloadItems.push(Object.freeze({ itemId: item.id, kind: item.kind, version: item.version, contentHash: item.contentHash, content: item.content, source: item.source, sensitivity: item.sensitivity }));
    }
    const at = currentTime(this.clock); if (!at.ok) return at;
    const manifestId = this.idFactory.create("rman_");
    const providerPayload = Object.freeze({ schemaVersion: "1.0.0" as const, projectId: input.projectId, authority: "working_memory_context_only_non_authoritative" as const, items: Object.freeze(payloadItems) });
    const base = Object.freeze({ schemaVersion: "1.0.0" as const, manifestId, projectId: input.projectId, provider: input.provider, projectStateHash: state.value.projection.stateHash, included: Object.freeze(included), excluded: Object.freeze(excluded), providerPayload });
    const manifestHash = hash(base); if (!manifestHash.ok) return manifestHash;
    const value: ManifestEntry = Object.freeze({
      ...base,
      authorityClass: "explicit_context_manifest_non_authoritative",
      status: "previewed",
      manifestHash: manifestHash.value,
      confirmationNonce: randomBytes(32).toString("hex"),
      createdAt: at.value,
      expiresAt: new Date(new Date(at.value).getTime() + MANIFEST_TTL_MS).toISOString(),
      version: 1,
    });
    this.#manifests.set(value.manifestId, value);
    return coreOk(value);
  }

  confirmManifest(input: { readonly projectId: string; readonly manifestId: string; readonly expectedVersion: number; readonly confirmationNonce: string; readonly manifestHash: string; readonly provider: ProjectMemoryProviderBinding; readonly actor: ResearchActor }): CoreResult<ProjectMemoryManifestProjection> {
    if (input.actor.kind !== "user") return coreErr("user_confirmation_required");
    const current = this.#manifests.get(input.manifestId);
    if (current?.projectId !== input.projectId) return coreErr("not_found");
    if (current.status !== "previewed" || current.version !== input.expectedVersion || current.confirmationNonce !== input.confirmationNonce || current.manifestHash !== input.manifestHash) return coreErr("user_confirmation_required");
    const fresh = this.manifestStillCurrent(current, input.provider); if (!fresh.ok) return fresh;
    const value = Object.freeze({ ...current, status: "confirmed" as const, version: current.version + 1 });
    this.#manifests.set(value.manifestId, value);
    return coreOk(value);
  }

  consumeManifest(input: { readonly projectId: string; readonly manifestId: string; readonly expectedVersion: number; readonly manifestHash: string; readonly provider: ProjectMemoryProviderBinding }): CoreResult<ProjectMemoryManifestProjection> {
    const current = this.#manifests.get(input.manifestId);
    if (current?.projectId !== input.projectId) return coreErr("not_found");
    if (current.status !== "confirmed" || current.version !== input.expectedVersion || current.manifestHash !== input.manifestHash) return coreErr("user_confirmation_required");
    const fresh = this.manifestStillCurrent(current, input.provider); if (!fresh.ok) return fresh;
    const value = Object.freeze({ ...current, status: "consumed" as const, version: current.version + 1 });
    this.#manifests.set(value.manifestId, value);
    return coreOk(value);
  }

  discardManifest(projectId: string, manifestId: string): void {
    const current = this.#manifests.get(manifestId);
    if (current?.projectId === projectId) this.#manifests.delete(manifestId);
  }

  private manifestStillCurrent(current: ManifestEntry, provider: ProjectMemoryProviderBinding): CoreResult<void> {
    if (!this.validProvider(provider) || !sameValue(provider, current.provider)) return coreErr("stale_state");
    const at = currentTime(this.clock); if (!at.ok) return at;
    if (new Date(at.value).getTime() >= new Date(current.expiresAt).getTime()) return coreErr("stale_state");
    const reconciled = this.reconcile(current.projectId); if (!reconciled.ok) return reconciled;
    const state = this.currentProjectState(current.projectId); if (!state.ok) return state;
    if (state.value.projection.stateHash !== current.projectStateHash) return coreErr("stale_state");
    for (const binding of current.included) {
      const item = this.store.workingMemory.getById(current.projectId, binding.itemId);
      if (!item.ok) return fromDomain(item);
      if (item.value?.state !== "active" || item.value.version !== binding.version || item.value.contentHash !== binding.contentHash || item.value.outboundPolicy !== "explicit_manifest_only" || item.value.sensitivity === "secret_never_send") return coreErr("stale_state");
    }
    return coreOk(undefined);
  }

  private reconcile(projectId: string): CoreResult<void> {
    const state = this.currentProjectState(projectId); if (!state.ok) return state;
    const page = this.store.workingMemory.listByProject(projectId, { limit: PAGE_LIMIT }, ["candidate", "active", "stale", "expired"]);
    if (!page.ok) return fromDomain(page);
    if (page.value.nextCursor !== undefined) return coreErr("state_conflict");
    for (const item of page.value.items) {
      if (item.state === "forgotten") continue;
      let current: LiveProjectWorkingMemory = item;
      if (current.source.kind === "project_object") {
        const source = this.resolveProjectObject(projectId, current.source.objectKind, current.source.objectId);
        const stale = markProjectWorkingMemorySourceStale(current, {
          sourceAvailable: source.ok,
          ...(source.ok ? { objectVersion: source.value.version, contentFingerprint: source.value.fingerprint } : {}),
          publicReason: source.ok ? "The pinned source version or content changed." : "The pinned source is no longer available.",
        }, this.ports);
        if (!stale.ok) return fromDomain(stale);
        if (stale.value.version !== current.version) {
          const persisted = this.store.workingMemory.compareAndSwap(stale.value, current.version);
          if (!persisted.ok) return fromDomain(persisted);
          current = persisted.value as LiveProjectWorkingMemory;
        }
      }
      const expired = expireProjectWorkingMemory(current, {
        currentEpisodeActive: current.retention.policy !== "current_episode" || current.retention.episodeId === state.value.currentEpisodeId,
        publicReason: "The configured project-memory retention boundary elapsed.",
      }, this.ports);
      if (!expired.ok) return fromDomain(expired);
      if (expired.value.version !== current.version) {
        const persisted = this.store.workingMemory.compareAndSwap(expired.value, current.version);
        if (!persisted.ok) return fromDomain(persisted);
      }
    }
    return coreOk(undefined);
  }

  private currentProjectState(projectId: string): CoreResult<CurrentProjectState> {
    const project = this.store.projects.getById(projectId); if (!project.ok) return fromDomain(project);
    if (project.value === undefined) return coreErr("not_found");
    const briefs = this.store.briefs.listByProject(projectId, { limit: PAGE_LIMIT }); if (!briefs.ok) return fromDomain(briefs);
    const decisions = this.store.decisions.listByScope(projectId, undefined, { limit: PAGE_LIMIT }); if (!decisions.ok) return fromDomain(decisions);
    const issues = this.store.issues.listByStatus(projectId, undefined, { limit: PAGE_LIMIT }); if (!issues.ok) return fromDomain(issues);
    const episodes = this.store.episodes.listByProject(projectId, { limit: PAGE_LIMIT }); if (!episodes.ok) return fromDomain(episodes);
    const appeals = this.store.correctionAppeals.listByProject(projectId, { limit: PAGE_LIMIT }); if (!appeals.ok) return fromDomain(appeals);
    const rooms = this.store.deliberationRooms.listByProject(projectId, { limit: PAGE_LIMIT }); if (!rooms.ok) return fromDomain(rooms);
    const receipts = this.store.roomReceipts.listByProject(projectId, { limit: PAGE_LIMIT }); if (!receipts.ok) return fromDomain(receipts);
    if ([briefs.value, decisions.value, issues.value, episodes.value, appeals.value, rooms.value, receipts.value].some((page) => page.nextCursor !== undefined)) return coreErr("state_conflict");
    const activeBriefs = briefs.value.items.map((brief) => ({ brief, version: getActiveResearchBriefVersion(brief) })).filter((item) => item.version !== undefined);
    const activeBrief = activeBriefs.sort((a, b) => (b.version?.createdAt ?? "").localeCompare(a.version?.createdAt ?? ""))[0];
    const activeDecisions = decisions.value.items.filter((item) => item.status === "accepted" || item.status === "frozen").sort((a, b) => a.id.localeCompare(b.id));
    const openIssues = issues.value.items.filter((item) => !["resolved"].includes(item.status)).sort((a, b) => a.id.localeCompare(b.id));
    const currentEpisode = episodes.value.items.filter((item) => !["accepted", "rejected", "disposed"].includes(item.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const activeAppeals = appeals.value.items.filter((item) => item.status !== "resolved").sort((a, b) => a.id.localeCompare(b.id));
    const activeRooms = rooms.value.items.filter((item) => !["resolved", "closed"].includes(item.status)).sort((a, b) => a.id.localeCompare(b.id));
    const recentReceipt = [...receipts.value.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const memory = this.readAllMemory(projectId); if (!memory.ok) return memory;
    const authorityBindings: ResumeAuthorityBinding[] = [{ kind: "project", id: project.value.id, version: project.value.version }];
    if (activeBrief?.version) authorityBindings.push({ kind: "brief", id: activeBrief.version.id, version: activeBrief.version.versionNumber });
    for (const item of activeDecisions) authorityBindings.push({ kind: "decision", id: item.id, version: item.version });
    for (const item of openIssues) authorityBindings.push({ kind: "issue", id: item.id, version: item.version });
    if (currentEpisode) authorityBindings.push({ kind: "episode", id: currentEpisode.id, version: currentEpisode.version });
    for (const item of activeAppeals) authorityBindings.push({ kind: "appeal", id: item.id, version: item.version });
    for (const item of activeRooms) authorityBindings.push({ kind: "deliberation_room", id: item.id, version: item.version });
    if (recentReceipt) authorityBindings.push({ kind: "receipt", id: recentReceipt.id, version: recentReceipt.version });
    authorityBindings.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    const snapshot: ResumeCurrentSnapshot = Object.freeze({
      projectId,
      projectVersion: project.value.version,
      authorityBindings: Object.freeze(authorityBindings),
      memoryBindings: Object.freeze(memory.value.map((item) => Object.freeze({ id: item.id, version: item.version, state: item.state })).sort((a, b) => a.id.localeCompare(b.id))),
    });
    const stateBase = Object.freeze({
      authorityClass: "kernel_authoritative_projection" as const,
      projectVersion: project.value.version,
      ...(activeBrief?.version ? { projectQuestion: activeBrief.version.projectQuestion, currentTask: activeBrief.version.currentTask, currentBrief: { id: activeBrief.version.id, version: activeBrief.version.versionNumber } } : {}),
      ...(currentEpisode ? { currentEpisode: { id: currentEpisode.id, status: currentEpisode.status, version: currentEpisode.version } } : {}),
      activeDecisions: Object.freeze(activeDecisions.map((item) => Object.freeze({ id: item.id, statement: item.statement, status: item.status, version: item.version }))),
      openIssues: Object.freeze(openIssues.map((item) => Object.freeze({ id: item.id, summary: item.summary, status: item.status, version: item.version }))),
      activeAppeals: Object.freeze(activeAppeals.map((item) => Object.freeze({ id: item.id, status: item.status, version: item.version }))),
      activeDeliberations: Object.freeze(activeRooms.map((item) => Object.freeze({ id: item.id, status: item.status, version: item.version }))),
      ...(recentReceipt ? { recentReceipt: { id: recentReceipt.id, status: recentReceipt.status, version: recentReceipt.version } } : {}),
      unproven: Object.freeze(["real_second_use_value", "repeatable_non_redundant_value_in_real_cases", "external_user_value"]),
    });
    const stateHash = hash({ projectId, snapshot, stateBase }); if (!stateHash.ok) return stateHash;
    return coreOk(Object.freeze({ projection: Object.freeze({ ...stateBase, stateHash: stateHash.value }), snapshot, ...(currentEpisode ? { currentEpisodeId: currentEpisode.id } : {}) }));
  }

  private readAllMemory(projectId: string): CoreResult<readonly ProjectWorkingMemory[]> {
    const items: ProjectWorkingMemory[] = [];
    let cursor: string | undefined;
    do {
      const page = this.store.workingMemory.listByProject(projectId, { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
      if (!page.ok) return fromDomain(page);
      items.push(...page.value.items);
      cursor = page.value.nextCursor;
      if (items.length > RESUME_MEMORY_LIMIT) return coreErr("state_conflict");
    } while (cursor !== undefined);
    return coreOk(Object.freeze(items));
  }

  private projectItem(item: ProjectWorkingMemory, at: Date): ProjectMemoryItemProjection {
    if (item.state === "forgotten") return Object.freeze({ id: item.id, projectId: item.projectId, authorityClass: item.authorityClass, state: item.state, version: item.version, recallEligible: false, manifestEligible: false, forgottenAt: item.forgottenAt, tombstone: item.tombstone });
    return Object.freeze({
      id: item.id,
      projectId: item.projectId,
      authorityClass: item.authorityClass,
      state: item.state,
      version: item.version,
      recallEligible: isProjectWorkingMemoryRecallEligible(item, item.projectId, at),
      manifestEligible: item.state === "active" && item.outboundPolicy === "explicit_manifest_only" && item.sensitivity !== "secret_never_send",
      kind: item.kind,
      content: item.content,
      contentHash: item.contentHash,
      source: item.source,
      retention: item.retention,
      sensitivity: item.sensitivity,
      outboundPolicy: item.outboundPolicy,
      semanticConflict: item.semanticConflict,
      ...(item.staleReason ? { staleReason: item.staleReason } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ...(item.confirmedAt ? { confirmedAt: item.confirmedAt } : {}),
      ...(item.expiredAt ? { expiredAt: item.expiredAt } : {}),
      ...(item.retiredAt ? { retiredAt: item.retiredAt } : {}),
      transitions: item.transitions,
    });
  }

  private attentionFor(item: ProjectWorkingMemory, at: Date): ProjectMemoryProjection["attention"][number][] {
    if (item.state === "forgotten" || item.state === "retired") return [];
    const base = { id: item.id, href: "/project/memory" as const };
    if (item.state === "candidate") return [Object.freeze({ ...base, kind: "memory_candidate" as const, title: `Working-memory candidate needs review · ${this.memoryLabel(item)}`, reason: "This candidate is local but is not recalled or sent until the user confirms it.", severity: "high" as const })];
    if (item.state === "stale") return [Object.freeze({ ...base, kind: "memory_stale" as const, title: "Pinned memory source changed", reason: `The source is stale (${item.staleReason ?? "source_changed"}); review or retire this item.`, severity: "high" as const })];
    if (item.state === "expired") return [Object.freeze({ ...base, kind: "memory_expired" as const, title: "Working memory expired", reason: "Renew, retire, or forget the expired item; it is not recalled or sent.", severity: "high" as const })];
    if (item.retention.policy === "until_date" && new Date(item.retention.expiresAt).getTime() - at.getTime() <= 7 * 86_400_000) return [Object.freeze({ ...base, kind: "memory_expiring" as const, title: "Working memory expires soon", reason: `Retention ends at ${item.retention.expiresAt}.`, severity: "normal" as const })];
    return [];
  }

  private memoryLabel(item: LiveProjectWorkingMemory): string {
    const label = "term" in item.content ? item.content.term : "purpose" in item.content ? item.content.purpose : item.content.text;
    return label.length > 96 ? `${label.slice(0, 95)}…` : label;
  }

  private defaultRetention(projectId: string, kind: ProjectWorkingMemoryKind): ProjectWorkingMemoryRetention | undefined {
    if (kind !== "workset") return { policy: "until_unpinned" };
    const state = this.currentProjectState(projectId);
    return state.ok && state.value.currentEpisodeId ? { policy: "current_episode", episodeId: state.value.currentEpisodeId } : undefined;
  }

  private requireItem(projectId: string, itemId: string): CoreResult<ProjectWorkingMemory> {
    return found(fromDomain(this.store.workingMemory.getById(projectId, itemId)));
  }

  private resolveProjectObject(projectId: string, kind: ProjectWorkingMemoryObjectKind, id: string): CoreResult<{ readonly version: number; readonly fingerprint: string }> {
    let value: unknown;
    let version: number | undefined;
    if (kind === "decision") { const result = this.store.decisions.getById(projectId, id); if (!result.ok) return fromDomain(result); value = result.value; version = result.value?.version; }
    else if (kind === "issue") { const result = this.store.issues.getById(projectId, id); if (!result.ok) return fromDomain(result); value = result.value; version = result.value?.version; }
    else if (kind === "evidence") { const result = this.store.argumentEvidence.getById(projectId, id); if (!result.ok) return fromDomain(result); value = result.value; version = result.value?.version; }
    else if (kind === "episode") { const result = this.store.episodes.getById(projectId, id); if (!result.ok) return fromDomain(result); value = result.value; version = result.value?.version; }
    else if (kind === "appeal") { const result = this.store.correctionAppeals.getById(projectId, id); if (!result.ok) return fromDomain(result); value = result.value; version = result.value?.version; }
    else if (kind === "deliberation_room") { const result = this.store.deliberationRooms.getById(projectId, id); if (!result.ok) return fromDomain(result); value = result.value; version = result.value?.version; }
    else if (kind === "receipt") { const result = this.store.roomReceipts.getById(projectId, id); if (!result.ok) return fromDomain(result); value = result.value; version = result.value?.version; }
    else if (kind === "artifact") { const result = this.store.artifacts.getById(projectId, id); if (!result.ok) return fromDomain(result); value = result.value; version = result.value?.version; }
    else if (kind === "brief") {
      const result = this.store.briefs.listByProject(projectId, { limit: PAGE_LIMIT }); if (!result.ok) return fromDomain(result);
      if (result.value.nextCursor !== undefined) return coreErr("state_conflict");
      for (const brief of result.value.items) {
        if (brief.id === id) { value = brief; version = brief.version; break; }
        const briefVersion = brief.versions.find((item) => item.id === id);
        if (briefVersion) { value = briefVersion; version = briefVersion.versionNumber; break; }
      }
    } else {
      const artifacts = this.store.artifacts.listByProject(projectId, { limit: PAGE_LIMIT }); if (!artifacts.ok) return fromDomain(artifacts);
      if (artifacts.value.nextCursor !== undefined) return coreErr("state_conflict");
      for (const artifact of artifacts.value.items) {
        const result = this.store.revisions.getById(projectId, artifact.id, id); if (!result.ok) return fromDomain(result);
        if (result.value) { value = result.value; version = 1; break; }
      }
    }
    if (value === undefined || version === undefined) return coreErr("not_found");
    const fingerprint = hash(value); return fingerprint.ok ? coreOk(Object.freeze({ version, fingerprint: fingerprint.value })) : fingerprint;
  }

  private validProvider(value: ProjectMemoryProviderBinding): boolean {
    return typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 256 && ["none", "deterministic_fixture", "local", "external"].includes(value.kind) && validSha(value.configHash) && typeof value.networkRequired === "boolean" && (value.kind !== "none" || !value.networkRequired);
  }

  private get ports(): { readonly clock: Clock; readonly idFactory: IdFactory } {
    return { clock: this.clock, idFactory: this.idFactory };
  }
}
