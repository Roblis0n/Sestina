import type { ResearchActor } from "../authority/actor.js";
import { validateResearchActor } from "../authority/actor.js";
import { validateUtcTimestamp } from "../authority/source.js";
import type { Clock } from "../clock.js";
import { cloneFrozen, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { stableResearchHash } from "../identity/canonical-json.js";
import {
  advanceEntityVersion,
  initialEntityVersion,
  parseEntityVersion,
  type EntityVersion,
} from "../identity/entity-version.js";
import { parseResearchId, parseResearchIdFor, type ResearchIdPrefix } from "../identity/research-id.js";
import { err, ok, type ResearchResult } from "../result.js";

export const PROJECT_WORKING_MEMORY_KINDS = ["term", "working_hint", "resume_note", "workset"] as const;
export type ProjectWorkingMemoryKind = (typeof PROJECT_WORKING_MEMORY_KINDS)[number];

export const PROJECT_WORKING_MEMORY_STATES = ["candidate", "active", "stale", "expired", "retired", "forgotten"] as const;
export type ProjectWorkingMemoryState = (typeof PROJECT_WORKING_MEMORY_STATES)[number];

export const PROJECT_WORKING_MEMORY_SENSITIVITIES = ["public", "project_private", "sensitive", "secret_never_send"] as const;
export type ProjectWorkingMemorySensitivity = (typeof PROJECT_WORKING_MEMORY_SENSITIVITIES)[number];

export const PROJECT_WORKING_MEMORY_OUTBOUND_POLICIES = ["never_send", "explicit_manifest_only"] as const;
export type ProjectWorkingMemoryOutboundPolicy = (typeof PROJECT_WORKING_MEMORY_OUTBOUND_POLICIES)[number];

export const PROJECT_WORKING_MEMORY_MAX_CONTENT_BYTES = 16_384;
export const PROJECT_WORKING_MEMORY_MAX_REFS = 64;
export const PROJECT_WORKING_MEMORY_MAX_ACTIVE_ITEMS = 200;
export const RESUME_CHECKPOINT_MAX_BINDINGS = 400;

export type ProjectWorkingMemoryContent =
  | { readonly term: string; readonly definition: string }
  | { readonly text: string }
  | { readonly purpose: string; readonly refs: readonly ProjectWorkingMemoryObjectRef[] };

export interface ProjectWorkingMemoryObjectRef {
  readonly kind: ProjectWorkingMemoryObjectKind;
  readonly id: string;
  readonly version: number;
}

export const PROJECT_WORKING_MEMORY_OBJECT_KINDS = [
  "brief", "decision", "issue", "evidence", "episode", "appeal", "deliberation_room", "receipt", "artifact", "revision",
] as const;
export type ProjectWorkingMemoryObjectKind = (typeof PROJECT_WORKING_MEMORY_OBJECT_KINDS)[number];

export type ProjectWorkingMemorySource =
  | { readonly kind: "direct_user"; readonly actorId: string }
  | {
      readonly kind: "project_object";
      readonly objectKind: ProjectWorkingMemoryObjectKind;
      readonly objectId: string;
      readonly objectVersion: number;
      readonly contentFingerprint: string;
    };

export type ProjectWorkingMemoryRetention =
  | { readonly policy: "current_episode"; readonly episodeId: string }
  | { readonly policy: "until_date"; readonly expiresAt: string }
  | { readonly policy: "until_unpinned" };

export type ProjectWorkingMemoryStaleReason = "source_version_changed" | "source_content_changed" | "source_unavailable";

export interface ProjectWorkingMemoryTransition {
  readonly action: "created" | "confirmed" | "edited" | "source_stale" | "expired" | "renewed" | "retired";
  readonly from?: Exclude<ProjectWorkingMemoryState, "forgotten">;
  readonly to: Exclude<ProjectWorkingMemoryState, "forgotten">;
  readonly actor: "user" | "kernel";
  readonly at: string;
  readonly publicReason: string;
}

export interface LiveProjectWorkingMemory {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly authorityClass: "working_memory_non_authoritative";
  readonly kind: ProjectWorkingMemoryKind;
  readonly state: Exclude<ProjectWorkingMemoryState, "forgotten">;
  readonly content: ProjectWorkingMemoryContent;
  readonly contentHash: string;
  readonly source: ProjectWorkingMemorySource;
  readonly retention: ProjectWorkingMemoryRetention;
  readonly sensitivity: ProjectWorkingMemorySensitivity;
  readonly outboundPolicy: ProjectWorkingMemoryOutboundPolicy;
  readonly semanticConflict: "semantic_conflict_unchecked";
  readonly staleReason?: ProjectWorkingMemoryStaleReason;
  readonly supersedesItemId?: string;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly confirmedAt?: string;
  readonly expiredAt?: string;
  readonly retiredAt?: string;
  readonly transitions: readonly ProjectWorkingMemoryTransition[];
  readonly version: EntityVersion;
}

export interface ForgottenProjectWorkingMemory {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly authorityClass: "working_memory_non_authoritative";
  readonly state: "forgotten";
  readonly tombstone: "irreversible_forget_recorded";
  readonly forgottenAt: string;
  readonly version: EntityVersion;
}

export type ProjectWorkingMemory = LiveProjectWorkingMemory | ForgottenProjectWorkingMemory;

export const RESUME_AUTHORITY_BINDING_KINDS = [
  "project", "brief", "decision", "issue", "evidence", "episode", "appeal", "deliberation_room", "receipt",
] as const;
export type ResumeAuthorityBindingKind = (typeof RESUME_AUTHORITY_BINDING_KINDS)[number];

export interface ResumeAuthorityBinding {
  readonly kind: ResumeAuthorityBindingKind;
  readonly id: string;
  readonly version: number;
}

export interface ResumeMemoryBinding {
  readonly id: string;
  readonly version: number;
  readonly state: ProjectWorkingMemoryState;
}

export interface ResumeCheckpoint {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly authorityClass: "resume_checkpoint_non_authoritative";
  readonly projectVersion: number;
  readonly authorityBindings: readonly ResumeAuthorityBinding[];
  readonly memoryBindings: readonly ResumeMemoryBinding[];
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
  readonly publicReason: string;
  readonly version: EntityVersion;
}

export interface ResumeCurrentSnapshot {
  readonly projectId: string;
  readonly projectVersion: number;
  readonly authorityBindings: readonly ResumeAuthorityBinding[];
  readonly memoryBindings: readonly ResumeMemoryBinding[];
}

export interface ResumeChanges {
  readonly projectChanged: boolean;
  readonly authority: readonly (
    | { readonly change: "added"; readonly kind: ResumeAuthorityBindingKind; readonly id: string; readonly afterVersion: number }
    | { readonly change: "updated"; readonly kind: ResumeAuthorityBindingKind; readonly id: string; readonly beforeVersion: number; readonly afterVersion: number }
    | { readonly change: "removed"; readonly kind: ResumeAuthorityBindingKind; readonly id: string; readonly beforeVersion: number }
  )[];
  readonly workingMemory: readonly (
    | { readonly change: "added"; readonly id: string; readonly afterVersion: number; readonly afterState: ProjectWorkingMemoryState }
    | { readonly change: "updated"; readonly id: string; readonly beforeVersion: number; readonly afterVersion: number; readonly beforeState: ProjectWorkingMemoryState; readonly afterState: ProjectWorkingMemoryState }
    | { readonly change: "removed"; readonly id: string; readonly beforeVersion: number; readonly beforeState: ProjectWorkingMemoryState }
  )[];
  readonly summaryAuthority: "system_derived_deterministic_non_authoritative";
}

interface DomainPorts { readonly clock: Clock; readonly idFactory: { create(prefix: ResearchIdPrefix): string } }

function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function text(value: unknown, maximumBytes = PROJECT_WORKING_MEMORY_MAX_CONTENT_BYTES): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || Buffer.byteLength(normalized, "utf8") > maximumBytes || normalized.includes("\0")) return undefined;
  return normalized;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function user(actor: unknown): ResearchResult<ResearchActor & { readonly kind: "user" }> {
  const parsed = validateResearchActor(actor);
  return parsed.ok && parsed.value.kind === "user"
    ? ok(parsed.value)
    : err(researchError("user_working_memory_action_required"));
}

function now(ports: DomainPorts): ResearchResult<string> {
  const value = readClock(ports.clock);
  return value.ok ? value : err(researchError("invalid_project_working_memory"));
}

function hash(value: unknown): ResearchResult<string> {
  const result = stableResearchHash(value);
  return result.ok ? result : err(researchError("invalid_project_working_memory"));
}

function parseObjectRef(value: unknown): ProjectWorkingMemoryObjectRef | undefined {
  if (!isRecord(value) || !exact(value, ["kind", "id", "version"])) return undefined;
  const kind = value.kind as ProjectWorkingMemoryObjectKind;
  if (!PROJECT_WORKING_MEMORY_OBJECT_KINDS.includes(kind) || !parseResearchId(value.id).ok || !positive(value.version)) return undefined;
  return Object.freeze({ kind, id: String(value.id), version: value.version });
}

function parseContent(kind: ProjectWorkingMemoryKind, value: unknown): ProjectWorkingMemoryContent | undefined {
  if (!isRecord(value)) return undefined;
  if (kind === "term") {
    if (!exact(value, ["term", "definition"])) return undefined;
    const term = text(value.term, 1_024); const definition = text(value.definition);
    return term && definition ? Object.freeze({ term, definition }) : undefined;
  }
  if (kind === "working_hint" || kind === "resume_note") {
    if (!exact(value, ["text"])) return undefined;
    const body = text(value.text);
    return body ? Object.freeze({ text: body }) : undefined;
  }
  if (!exact(value, ["purpose", "refs"]) || !Array.isArray(value.refs) || value.refs.length === 0 || value.refs.length > PROJECT_WORKING_MEMORY_MAX_REFS) return undefined;
  const purpose = text(value.purpose, 4_096);
  const refs = value.refs.map(parseObjectRef);
  if (!purpose || refs.some((item) => item === undefined)) return undefined;
  const typed = refs as ProjectWorkingMemoryObjectRef[];
  if (new Set(typed.map((item) => `${item.kind}:${item.id}`)).size !== typed.length) return undefined;
  return Object.freeze({ purpose, refs: Object.freeze(typed) });
}

function parseSource(value: unknown): ProjectWorkingMemorySource | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "direct_user") {
    if (!exact(value, ["kind", "actorId"])) return undefined;
    const actorId = text(value.actorId, 256);
    return actorId ? Object.freeze({ kind: "direct_user" as const, actorId }) : undefined;
  }
  if (value.kind !== "project_object" || !exact(value, ["kind", "objectKind", "objectId", "objectVersion", "contentFingerprint"])) return undefined;
  const objectKind = value.objectKind as ProjectWorkingMemoryObjectKind;
  if (!PROJECT_WORKING_MEMORY_OBJECT_KINDS.includes(objectKind) || !parseResearchId(value.objectId).ok || !positive(value.objectVersion) || !sha(value.contentFingerprint)) return undefined;
  return Object.freeze({ kind: "project_object" as const, objectKind, objectId: String(value.objectId), objectVersion: value.objectVersion, contentFingerprint: value.contentFingerprint });
}

function parseRetention(value: unknown): ProjectWorkingMemoryRetention | undefined {
  if (!isRecord(value)) return undefined;
  if (value.policy === "until_unpinned" && exact(value, ["policy"])) return Object.freeze({ policy: "until_unpinned" as const });
  if (value.policy === "until_date" && exact(value, ["policy", "expiresAt"])) {
    const at = validateUtcTimestamp(value.expiresAt);
    return at.ok ? Object.freeze({ policy: "until_date" as const, expiresAt: at.value }) : undefined;
  }
  if (value.policy === "current_episode" && exact(value, ["policy", "episodeId"]) && parseResearchIdFor(value.episodeId, "repi_").ok) {
    return Object.freeze({ policy: "current_episode" as const, episodeId: String(value.episodeId) });
  }
  return undefined;
}

function parseTransition(value: unknown): ProjectWorkingMemoryTransition | undefined {
  if (!isRecord(value) || !exact(value, ["action", "to", "actor", "at", "publicReason"], ["from"])) return undefined;
  const actions = ["created", "confirmed", "edited", "source_stale", "expired", "renewed", "retired"];
  const states = PROJECT_WORKING_MEMORY_STATES.filter((state) => state !== "forgotten");
  const at = validateUtcTimestamp(value.at); const reason = text(value.publicReason, 4_096);
  if (!actions.includes(String(value.action)) || !states.includes(value.to as never) || (value.from !== undefined && !states.includes(value.from as never)) || !["user", "kernel"].includes(String(value.actor)) || !at.ok || !reason) return undefined;
  return Object.freeze({ action: value.action, ...(value.from === undefined ? {} : { from: value.from }), to: value.to, actor: value.actor, at: at.value, publicReason: reason } as ProjectWorkingMemoryTransition);
}

function parseLive(value: Record<string, unknown>): ResearchResult<LiveProjectWorkingMemory> {
  const required = ["schemaVersion", "id", "projectId", "authorityClass", "kind", "state", "content", "contentHash", "source", "retention", "sensitivity", "outboundPolicy", "semanticConflict", "createdByUserId", "createdAt", "updatedAt", "transitions", "version"];
  const optional = ["staleReason", "supersedesItemId", "confirmedAt", "expiredAt", "retiredAt"];
  if (!exact(value, required, optional) || value.schemaVersion !== "1.0.0" || value.authorityClass !== "working_memory_non_authoritative") return err(researchError("invalid_project_working_memory"));
  const id = parseResearchIdFor(value.id, "rmem_"); const project = parseResearchIdFor(value.projectId, "rprj_"); const version = parseEntityVersion(value.version);
  const kind = value.kind as ProjectWorkingMemoryKind; const state = value.state as LiveProjectWorkingMemory["state"];
  const content = PROJECT_WORKING_MEMORY_KINDS.includes(kind) ? parseContent(kind, value.content) : undefined;
  const source = parseSource(value.source); const retention = parseRetention(value.retention);
  const sensitivity = value.sensitivity as ProjectWorkingMemorySensitivity; const outbound = value.outboundPolicy as ProjectWorkingMemoryOutboundPolicy;
  const createdBy = text(value.createdByUserId, 256); const createdAt = validateUtcTimestamp(value.createdAt); const updatedAt = validateUtcTimestamp(value.updatedAt);
  if (!id.ok || !project.ok || !version.ok || !PROJECT_WORKING_MEMORY_KINDS.includes(kind) || !PROJECT_WORKING_MEMORY_STATES.filter((item) => item !== "forgotten").includes(state) || content === undefined || source === undefined || retention === undefined || !PROJECT_WORKING_MEMORY_SENSITIVITIES.includes(sensitivity) || !PROJECT_WORKING_MEMORY_OUTBOUND_POLICIES.includes(outbound) || value.semanticConflict !== "semantic_conflict_unchecked" || !sha(value.contentHash) || !createdBy || !createdAt.ok || !updatedAt.ok || !Array.isArray(value.transitions) || value.transitions.length === 0 || value.transitions.length > 256) return err(researchError("invalid_project_working_memory"));
  if (sensitivity === "secret_never_send" && outbound !== "never_send") return err(researchError("invalid_project_working_memory"));
  const calculated = hash(content); if (!calculated.ok || calculated.value !== value.contentHash) return err(researchError("invalid_project_working_memory"));
  const transitions = value.transitions.map(parseTransition); if (transitions.some((item) => item === undefined) || transitions.at(-1)?.to !== state) return err(researchError("invalid_project_working_memory"));
  if (source.kind === "direct_user" && source.actorId !== createdBy) return err(researchError("invalid_project_working_memory"));
  const timestamps: Record<string, string> = {};
  for (const field of ["confirmedAt", "expiredAt", "retiredAt"] as const) {
    if (value[field] !== undefined) { const parsed = validateUtcTimestamp(value[field]); if (!parsed.ok) return err(researchError("invalid_project_working_memory")); timestamps[field] = parsed.value; }
  }
  if (value.staleReason !== undefined && !["source_version_changed", "source_content_changed", "source_unavailable"].includes(value.staleReason as string)) return err(researchError("invalid_project_working_memory"));
  if (value.supersedesItemId !== undefined && !parseResearchIdFor(value.supersedesItemId, "rmem_").ok) return err(researchError("invalid_project_working_memory"));
  return ok(cloneFrozen({ ...value, id: id.value.id, projectId: project.value.id, kind, state, content, source, retention, sensitivity, outboundPolicy: outbound, createdByUserId: createdBy, createdAt: createdAt.value, updatedAt: updatedAt.value, transitions: transitions as ProjectWorkingMemoryTransition[], version: version.value, ...timestamps } as unknown as LiveProjectWorkingMemory));
}

export function parseProjectWorkingMemory(value: unknown): ResearchResult<ProjectWorkingMemory> {
  if (!isRecord(value)) return err(researchError("invalid_project_working_memory"));
  if (value.state !== "forgotten") return parseLive(value);
  if (!exact(value, ["schemaVersion", "id", "projectId", "authorityClass", "state", "tombstone", "forgottenAt", "version"]) || value.schemaVersion !== "1.0.0" || value.authorityClass !== "working_memory_non_authoritative" || value.tombstone !== "irreversible_forget_recorded") return err(researchError("invalid_project_working_memory"));
  const id = parseResearchIdFor(value.id, "rmem_"); const project = parseResearchIdFor(value.projectId, "rprj_"); const at = validateUtcTimestamp(value.forgottenAt); const version = parseEntityVersion(value.version);
  return id.ok && project.ok && at.ok && version.ok
    ? ok(Object.freeze({ schemaVersion: "1.0.0", id: id.value.id, projectId: project.value.id, authorityClass: "working_memory_non_authoritative", state: "forgotten", tombstone: "irreversible_forget_recorded", forgottenAt: at.value, version: version.value }))
    : err(researchError("invalid_project_working_memory"));
}

export interface CreateProjectWorkingMemoryCandidateInput {
  readonly projectId: string;
  readonly kind: ProjectWorkingMemoryKind;
  readonly content: ProjectWorkingMemoryContent;
  readonly source: ProjectWorkingMemorySource;
  readonly retention: ProjectWorkingMemoryRetention;
  readonly sensitivity: ProjectWorkingMemorySensitivity;
  readonly outboundPolicy: ProjectWorkingMemoryOutboundPolicy;
  readonly supersedesItemId?: string;
  readonly publicReason: string;
  readonly actor: ResearchActor;
}

export function createProjectWorkingMemoryCandidate(input: CreateProjectWorkingMemoryCandidateInput, ports: DomainPorts): ResearchResult<LiveProjectWorkingMemory> {
  const actor = user(input.actor); const project = parseResearchIdFor(input.projectId, "rprj_"); const id = parseResearchIdFor(ports.idFactory.create("rmem_"), "rmem_"); const at = now(ports);
  const content = PROJECT_WORKING_MEMORY_KINDS.includes(input.kind) ? parseContent(input.kind, input.content) : undefined;
  const source = parseSource(input.source); const retention = parseRetention(input.retention); const reason = text(input.publicReason, 4_096);
  if (!actor.ok || !project.ok || !id.ok || !at.ok || content === undefined || source === undefined || retention === undefined || !PROJECT_WORKING_MEMORY_SENSITIVITIES.includes(input.sensitivity) || !PROJECT_WORKING_MEMORY_OUTBOUND_POLICIES.includes(input.outboundPolicy) || !reason) return !actor.ok ? actor : err(researchError("invalid_project_working_memory"));
  if (source.kind === "direct_user" && source.actorId !== actor.value.actorId) return err(researchError("invalid_project_working_memory"));
  if (input.sensitivity === "secret_never_send" && input.outboundPolicy !== "never_send") return err(researchError("invalid_project_working_memory"));
  if (input.supersedesItemId !== undefined && !parseResearchIdFor(input.supersedesItemId, "rmem_").ok) return err(researchError("invalid_project_working_memory"));
  const contentHash = hash(content); if (!contentHash.ok) return contentHash;
  const candidate: LiveProjectWorkingMemory = {
    schemaVersion: "1.0.0", id: id.value.id, projectId: project.value.id, authorityClass: "working_memory_non_authoritative",
    kind: input.kind, state: "candidate", content, contentHash: contentHash.value, source, retention,
    sensitivity: input.sensitivity, outboundPolicy: input.outboundPolicy, semanticConflict: "semantic_conflict_unchecked",
    ...(input.supersedesItemId === undefined ? {} : { supersedesItemId: input.supersedesItemId }),
    createdByUserId: actor.value.actorId, createdAt: at.value, updatedAt: at.value,
    transitions: Object.freeze([{ action: "created", to: "candidate", actor: "user", at: at.value, publicReason: reason }]),
    version: initialEntityVersion(),
  };
  return parseLive(candidate as unknown as Record<string, unknown>);
}

function expectedNext(memory: LiveProjectWorkingMemory, expected: EntityVersion | number): ResearchResult<EntityVersion> {
  const parsed = parseEntityVersion(expected); if (!parsed.ok) return parsed;
  return advanceEntityVersion(memory.version, parsed.value);
}

function omitUndefined(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function transition(memory: LiveProjectWorkingMemory, input: { readonly nextVersion: EntityVersion; readonly state: LiveProjectWorkingMemory["state"]; readonly action: ProjectWorkingMemoryTransition["action"]; readonly actor: "user" | "kernel"; readonly at: string; readonly publicReason: string; readonly patch?: Readonly<Record<string, unknown>> }): ResearchResult<LiveProjectWorkingMemory> {
  const next = { ...memory, ...input.patch, state: input.state, updatedAt: input.at, version: input.nextVersion, transitions: [...memory.transitions, { action: input.action, from: memory.state, to: input.state, actor: input.actor, at: input.at, publicReason: input.publicReason }] };
  return parseLive(omitUndefined(next));
}

export function confirmProjectWorkingMemory(memory: ProjectWorkingMemory, input: { readonly expectedVersion: EntityVersion | number; readonly actor: ResearchActor; readonly publicReason: string }, ports: DomainPorts): ResearchResult<LiveProjectWorkingMemory> {
  const actor = user(input.actor); if (!actor.ok) return actor;
  if (memory.state !== "candidate") return err(researchError("invalid_working_memory_transition"));
  const version = expectedNext(memory, input.expectedVersion); const at = now(ports); const reason = text(input.publicReason, 4_096);
  if (!version.ok || !at.ok || !reason) return !version.ok ? version : err(researchError("invalid_project_working_memory"));
  return transition(memory, { nextVersion: version.value, state: "active", action: "confirmed", actor: "user", at: at.value, publicReason: reason, patch: { confirmedAt: at.value } });
}

export function editProjectWorkingMemory(memory: ProjectWorkingMemory, input: { readonly expectedVersion: EntityVersion | number; readonly content: ProjectWorkingMemoryContent; readonly retention: ProjectWorkingMemoryRetention; readonly sensitivity: ProjectWorkingMemorySensitivity; readonly outboundPolicy: ProjectWorkingMemoryOutboundPolicy; readonly source?: ProjectWorkingMemorySource; readonly publicReason: string; readonly actor: ResearchActor }, ports: DomainPorts): ResearchResult<LiveProjectWorkingMemory> {
  const actor = user(input.actor); if (!actor.ok) return actor;
  if (memory.state === "forgotten") return err(researchError("invalid_working_memory_transition"));
  const version = expectedNext(memory, input.expectedVersion); const at = now(ports); const content = parseContent(memory.kind, input.content); const retention = parseRetention(input.retention); const source = input.source === undefined ? memory.source : parseSource(input.source); const reason = text(input.publicReason, 4_096);
  if (!version.ok || !at.ok || content === undefined || retention === undefined || source === undefined || !PROJECT_WORKING_MEMORY_SENSITIVITIES.includes(input.sensitivity) || !PROJECT_WORKING_MEMORY_OUTBOUND_POLICIES.includes(input.outboundPolicy) || !reason || (input.sensitivity === "secret_never_send" && input.outboundPolicy !== "never_send")) return !version.ok ? version : err(researchError("invalid_project_working_memory"));
  if (memory.state === "stale" && memory.source.kind === "project_object" && input.source === undefined) return err(researchError("working_memory_source_mismatch"));
  const contentHash = hash(content); if (!contentHash.ok) return contentHash;
  const next = { ...memory, content, contentHash: contentHash.value, source, retention, sensitivity: input.sensitivity, outboundPolicy: input.outboundPolicy } as LiveProjectWorkingMemory;
  return transition(next, { nextVersion: version.value, state: "candidate", action: "edited", actor: "user", at: at.value, publicReason: reason, patch: { confirmedAt: undefined, expiredAt: undefined, retiredAt: undefined, staleReason: undefined } });
}

export function markProjectWorkingMemorySourceStale(memory: ProjectWorkingMemory, input: { readonly objectVersion?: number; readonly contentFingerprint?: string; readonly sourceAvailable: boolean; readonly publicReason: string }, ports: DomainPorts): ResearchResult<LiveProjectWorkingMemory> {
  if (memory.state === "forgotten" || memory.source.kind !== "project_object") return err(researchError("invalid_working_memory_transition"));
  let staleReason: ProjectWorkingMemoryStaleReason | undefined;
  if (!input.sourceAvailable) staleReason = "source_unavailable";
  else if (input.objectVersion !== memory.source.objectVersion) staleReason = "source_version_changed";
  else if (input.contentFingerprint !== memory.source.contentFingerprint) staleReason = "source_content_changed";
  if (staleReason === undefined) return ok(memory);
  if (memory.state === "stale" && memory.staleReason === staleReason) return ok(memory);
  const version = advanceEntityVersion(memory.version, memory.version); const at = now(ports); const reason = text(input.publicReason, 4_096);
  if (!version.ok || !at.ok || !reason) return err(researchError("invalid_project_working_memory"));
  return transition(memory, { nextVersion: version.value, state: "stale", action: "source_stale", actor: "kernel", at: at.value, publicReason: reason, patch: { staleReason } });
}

export function expireProjectWorkingMemory(memory: ProjectWorkingMemory, input: { readonly currentEpisodeActive: boolean; readonly publicReason: string }, ports: DomainPorts): ResearchResult<LiveProjectWorkingMemory> {
  if (memory.state === "forgotten" || memory.state === "retired") return err(researchError("invalid_working_memory_transition"));
  const at = now(ports); const reason = text(input.publicReason, 4_096); if (!at.ok || !reason) return err(researchError("invalid_project_working_memory"));
  const shouldExpire = memory.retention.policy === "until_date"
    ? new Date(at.value).getTime() >= new Date(memory.retention.expiresAt).getTime()
    : memory.retention.policy === "current_episode" ? !input.currentEpisodeActive : false;
  if (!shouldExpire || memory.state === "expired") return ok(memory);
  const version = advanceEntityVersion(memory.version, memory.version); if (!version.ok) return version;
  return transition(memory, { nextVersion: version.value, state: "expired", action: "expired", actor: "kernel", at: at.value, publicReason: reason, patch: { expiredAt: at.value } });
}

export function renewProjectWorkingMemory(memory: ProjectWorkingMemory, input: { readonly expectedVersion: EntityVersion | number; readonly retention: ProjectWorkingMemoryRetention; readonly actor: ResearchActor; readonly publicReason: string }, ports: DomainPorts): ResearchResult<LiveProjectWorkingMemory> {
  const actor = user(input.actor); if (!actor.ok) return actor;
  if (memory.state === "forgotten" || memory.state === "retired" || memory.state === "candidate") return err(researchError("invalid_working_memory_transition"));
  const version = expectedNext(memory, input.expectedVersion); const at = now(ports); const retention = parseRetention(input.retention); const reason = text(input.publicReason, 4_096);
  if (!version.ok || !at.ok || retention === undefined || !reason) return !version.ok ? version : err(researchError("invalid_project_working_memory"));
  if (retention.policy === "until_date" && new Date(retention.expiresAt).getTime() <= new Date(at.value).getTime()) return err(researchError("invalid_project_working_memory"));
  return transition(memory, { nextVersion: version.value, state: memory.staleReason ? "stale" : "active", action: "renewed", actor: "user", at: at.value, publicReason: reason, patch: { retention, expiredAt: undefined } });
}

export function retireProjectWorkingMemory(memory: ProjectWorkingMemory, input: { readonly expectedVersion: EntityVersion | number; readonly actor: ResearchActor; readonly publicReason: string }, ports: DomainPorts): ResearchResult<LiveProjectWorkingMemory> {
  const actor = user(input.actor); if (!actor.ok) return actor;
  if (memory.state === "forgotten" || memory.state === "retired") return err(researchError("invalid_working_memory_transition"));
  const version = expectedNext(memory, input.expectedVersion); const at = now(ports); const reason = text(input.publicReason, 4_096);
  if (!version.ok || !at.ok || !reason) return !version.ok ? version : err(researchError("invalid_project_working_memory"));
  return transition(memory, { nextVersion: version.value, state: "retired", action: "retired", actor: "user", at: at.value, publicReason: reason, patch: { retiredAt: at.value } });
}

export function forgetProjectWorkingMemory(memory: ProjectWorkingMemory, input: { readonly expectedVersion: EntityVersion | number; readonly actor: ResearchActor; readonly confirmation: string; readonly publicReason: string }, ports: DomainPorts): ResearchResult<ForgottenProjectWorkingMemory> {
  const actor = user(input.actor); if (!actor.ok) return actor;
  if (memory.state === "forgotten" || input.confirmation !== "FORGET" || input.publicReason !== "user_requested_irreversible_forget") return err(researchError("invalid_working_memory_transition"));
  const version = expectedNext(memory, input.expectedVersion); const at = now(ports);
  if (!version.ok || !at.ok) return !version.ok ? version : err(researchError("invalid_project_working_memory"));
  return ok(Object.freeze({ schemaVersion: "1.0.0", id: memory.id, projectId: memory.projectId, authorityClass: "working_memory_non_authoritative", state: "forgotten", tombstone: "irreversible_forget_recorded", forgottenAt: at.value, version: version.value }));
}

export function isProjectWorkingMemoryRecallEligible(memory: ProjectWorkingMemory, projectId: string, at: Date): boolean {
  if (memory.projectId !== projectId || memory.state !== "active" || !(at instanceof Date) || !Number.isFinite(at.getTime())) return false;
  return memory.retention.policy !== "until_date" || new Date(memory.retention.expiresAt).getTime() > at.getTime();
}

function parseAuthorityBinding(value: unknown): ResumeAuthorityBinding | undefined {
  if (!isRecord(value) || !exact(value, ["kind", "id", "version"])) return undefined;
  const kind = value.kind as ResumeAuthorityBindingKind;
  return RESUME_AUTHORITY_BINDING_KINDS.includes(kind) && parseResearchId(value.id).ok && positive(value.version)
    ? Object.freeze({ kind, id: String(value.id), version: value.version }) : undefined;
}

function parseMemoryBinding(value: unknown): ResumeMemoryBinding | undefined {
  if (!isRecord(value) || !exact(value, ["id", "version", "state"]) || !parseResearchIdFor(value.id, "rmem_").ok || !positive(value.version) || !PROJECT_WORKING_MEMORY_STATES.includes(value.state as ProjectWorkingMemoryState)) return undefined;
  return Object.freeze({ id: String(value.id), version: value.version, state: value.state as ProjectWorkingMemoryState });
}

function parseBindings<T>(value: unknown, parser: (item: unknown) => T | undefined): readonly T[] | undefined {
  if (!Array.isArray(value) || value.length > RESUME_CHECKPOINT_MAX_BINDINGS) return undefined;
  const parsed = value.map(parser); if (parsed.some((item) => item === undefined)) return undefined;
  const typed = parsed as T[]; const keys = typed.map((item) => JSON.stringify(item));
  return new Set(keys).size === typed.length ? Object.freeze(typed) : undefined;
}

export function parseResumeCheckpoint(value: unknown): ResearchResult<ResumeCheckpoint> {
  if (!isRecord(value) || !exact(value, ["schemaVersion", "id", "projectId", "authorityClass", "projectVersion", "authorityBindings", "memoryBindings", "reviewedByUserId", "reviewedAt", "publicReason", "version"]) || value.schemaVersion !== "1.0.0" || value.authorityClass !== "resume_checkpoint_non_authoritative") return err(researchError("invalid_resume_checkpoint"));
  const id = parseResearchIdFor(value.id, "rmcp_"); const project = parseResearchIdFor(value.projectId, "rprj_"); const version = parseEntityVersion(value.version); const reviewedAt = validateUtcTimestamp(value.reviewedAt); const actor = text(value.reviewedByUserId, 256); const reason = text(value.publicReason, 4_096); const authorityBindings = parseBindings(value.authorityBindings, parseAuthorityBinding); const memoryBindings = parseBindings(value.memoryBindings, parseMemoryBinding);
  if (!id.ok || !project.ok || !version.ok || !positive(value.projectVersion) || !reviewedAt.ok || !actor || !reason || authorityBindings === undefined || memoryBindings === undefined) return err(researchError("invalid_resume_checkpoint"));
  return ok(cloneFrozen({ ...value, id: id.value.id, projectId: project.value.id, projectVersion: value.projectVersion, authorityBindings, memoryBindings, reviewedByUserId: actor, reviewedAt: reviewedAt.value, publicReason: reason, version: version.value } as unknown as ResumeCheckpoint));
}

export function createResumeCheckpoint(input: { readonly projectId: string; readonly projectVersion: number; readonly authorityBindings: readonly ResumeAuthorityBinding[]; readonly memoryBindings: readonly ResumeMemoryBinding[]; readonly actor: ResearchActor; readonly publicReason: string }, ports: DomainPorts): ResearchResult<ResumeCheckpoint> {
  const actor = user(input.actor); if (!actor.ok) return actor;
  const id = ports.idFactory.create("rmcp_"); const at = now(ports); if (!at.ok) return err(researchError("invalid_resume_checkpoint"));
  return parseResumeCheckpoint({ schemaVersion: "1.0.0", id, projectId: input.projectId, authorityClass: "resume_checkpoint_non_authoritative", projectVersion: input.projectVersion, authorityBindings: input.authorityBindings, memoryBindings: input.memoryBindings, reviewedByUserId: actor.value.actorId, reviewedAt: at.value, publicReason: input.publicReason, version: initialEntityVersion() });
}

export function computeResumeChanges(checkpoint: ResumeCheckpoint, current: ResumeCurrentSnapshot): ResearchResult<ResumeChanges> {
  const parsed = parseResumeCheckpoint(checkpoint); const project = parseResearchIdFor(current.projectId, "rprj_"); const authorityBindings = parseBindings(current.authorityBindings, parseAuthorityBinding); const memoryBindings = parseBindings(current.memoryBindings, parseMemoryBinding);
  if (!parsed.ok || !project.ok || project.value.id !== parsed.value.projectId || !positive(current.projectVersion) || authorityBindings === undefined || memoryBindings === undefined) return err(researchError("invalid_resume_checkpoint"));
  const beforeAuthority = new Map(parsed.value.authorityBindings.map((item) => [`${item.kind}:${item.id}`, item]));
  const afterAuthority = new Map(authorityBindings.map((item) => [`${item.kind}:${item.id}`, item]));
  const authority: ResumeChanges["authority"][number][] = [];
  for (const item of authorityBindings) { const before = beforeAuthority.get(`${item.kind}:${item.id}`); if (!before) authority.push({ change: "added", kind: item.kind, id: item.id, afterVersion: item.version }); else if (before.version !== item.version) authority.push({ change: "updated", kind: item.kind, id: item.id, beforeVersion: before.version, afterVersion: item.version }); }
  for (const item of parsed.value.authorityBindings) if (!afterAuthority.has(`${item.kind}:${item.id}`)) authority.push({ change: "removed", kind: item.kind, id: item.id, beforeVersion: item.version });
  const beforeMemory = new Map(parsed.value.memoryBindings.map((item) => [item.id, item])); const afterMemory = new Map(memoryBindings.map((item) => [item.id, item]));
  const workingMemory: ResumeChanges["workingMemory"][number][] = [];
  for (const item of memoryBindings) { const before = beforeMemory.get(item.id); if (!before) workingMemory.push({ change: "added", id: item.id, afterVersion: item.version, afterState: item.state }); else if (before.version !== item.version || before.state !== item.state) workingMemory.push({ change: "updated", id: item.id, beforeVersion: before.version, afterVersion: item.version, beforeState: before.state, afterState: item.state }); }
  for (const item of parsed.value.memoryBindings) if (!afterMemory.has(item.id)) workingMemory.push({ change: "removed", id: item.id, beforeVersion: item.version, beforeState: item.state });
  return ok(Object.freeze({ projectChanged: parsed.value.projectVersion !== current.projectVersion, authority: Object.freeze(authority), workingMemory: Object.freeze(workingMemory), summaryAuthority: "system_derived_deterministic_non_authoritative" }));
}
