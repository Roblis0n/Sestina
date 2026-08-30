import {
  bindClosedPilotDisposition,
  bindClosedPilotReview,
  cancelClosedPilotAttempt,
  closeClosedExternalAppPilot,
  completeClosedPilotContinuity,
  confirmClosedPilotContext,
  createClosedExternalAppPilot,
  createClosedPilotEvidenceExport,
  expireClosedPilotConfirmation,
  failClosedPilotAttempt,
  importClosedPilotCandidate,
  markClosedPilotAttemptRunning,
  markClosedPilotStale,
  prepareClosedPilotContext,
  receiveClosedPilotCandidate,
  recordClosedPilotFeedback,
  recordClosedPilotPreflight,
  recoverInterruptedClosedPilot,
  rejectClosedPilotCandidate,
  requireClosedPilotCandidateConfirmation,
  restoreClosedPilotReview,
  stableResearchHash,
  startClosedPilotAttempt,
  type ClosedExternalAppPilot,
  type ClosedPilotCandidateInput,
  type ClosedPilotContinuityObservation,
  type ClosedPilotEvidenceClass,
  type ClosedPilotEvidenceExport,
  type ClosedPilotFailureCode,
  type ClosedPilotFeedbackCode,
  type ClosedPilotHostCapabilities,
  type ClosedPilotMcpObservation,
  type Clock,
  type IdFactory,
  type ResearchActor,
  type ResearchResult,
} from "@sestina/research";
import type { ResearchStore } from "@sestina/research-store";
import { coreErr, coreOk, fromDomain, type CoreResult } from "./errors.js";
import type { ProjectMemoryItemProjection, ProjectMemoryProjection } from "./project-memory.js";
import type { ResearchRoomState } from "./research-room.js";

const PAGE = Object.freeze({ limit: 200 });

export interface PrepareClosedExternalAppPilotContextInput {
  readonly projectId: string;
  readonly pilotId: string;
  readonly expectedVersion: number;
  readonly kind: "candidate_generation" | "continuity_check";
  readonly selectedMemoryItemIds: readonly string[];
  readonly confirmationExpiresAt: string;
  readonly externalModelServiceMayBeCalled: boolean;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly actor: ResearchActor;
}

export interface ClosedExternalAppPilotPage {
  readonly items: readonly ClosedExternalAppPilot[];
  readonly nextCursor?: string;
}

type StateReader = (projectId: string) => CoreResult<ResearchRoomState>;
type MemoryReader = (projectId: string, page: { readonly limit: number; readonly cursor?: string }) => CoreResult<ProjectMemoryProjection>;

function found<T>(value: CoreResult<T | undefined>): CoreResult<T> {
  return value.ok ? value.value === undefined ? coreErr("not_found") : coreOk(value.value) : value;
}

function pathLike(value: string): boolean {
  return /(?:[A-Za-z]:[\\/]|\\\\[^\s]+\\|\/(?:Users|home|tmp|private|var)\/)/u.test(value);
}

function memoryText(item: ProjectMemoryItemProjection): string | undefined {
  if (item.content === undefined) return undefined;
  const value = JSON.stringify(item.content);
  return value.length > 0 && !pathLike(value) ? value : undefined;
}

function issueReopenCondition(transitions: readonly { readonly reason: string }[]): string | undefined {
  const prefix = "Invalidation condition:";
  for (const transition of [...transitions].reverse()) {
    const index = transition.reason.indexOf(prefix);
    if (index >= 0) return transition.reason.slice(index + prefix.length).trim() || undefined;
  }
  return undefined;
}

export class ClosedExternalAppPilotService {
  constructor(
    private readonly store: ResearchStore,
    private readonly clock: Clock,
    private readonly idFactory: IdFactory,
    private readonly readState: StateReader,
    private readonly readMemory: MemoryReader,
  ) {}

  create(input: { readonly projectId: string; readonly evidenceClass: ClosedPilotEvidenceClass; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    const state = this.readState(input.projectId); if (!state.ok) return state;
    if (state.value.currentEpisode === undefined) return coreErr("state_conflict");
    const created = createClosedExternalAppPilot({
      projectId: input.projectId,
      brief: { id: state.value.brief.id, versionId: state.value.brief.versionId, version: state.value.brief.versionNumber },
      episode: { id: state.value.currentEpisode.id, version: state.value.currentEpisode.version },
      currentTask: state.value.brief.currentTask,
      actor: input.actor,
      evidenceClass: input.evidenceClass,
    }, this.ports);
    return created.ok ? fromDomain(this.store.closedExternalAppPilots.create(created.value)) : fromDomain(created);
  }

  get(projectId: string, pilotId: string): CoreResult<ClosedExternalAppPilot> {
    return found(fromDomain(this.store.closedExternalAppPilots.getById(projectId, pilotId)));
  }

  list(projectId: string, page: { readonly limit: number; readonly cursor?: string }): CoreResult<ClosedExternalAppPilotPage> {
    return fromDomain(this.store.closedExternalAppPilots.listByProject(projectId, page));
  }

  preflight(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly availability: "available" | "unavailable"; readonly supportedVersion: string | null; readonly verifiedAt?: string; readonly capabilities: ClosedPilotHostCapabilities }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => recordClosedPilotPreflight(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  prepare(input: PrepareClosedExternalAppPilotContextInput): CoreResult<ClosedExternalAppPilot> {
    const pilot = this.get(input.projectId, input.pilotId); if (!pilot.ok) return pilot;
    if (pilot.value.version !== input.expectedVersion) return coreErr("stale_state");
    const state = this.readState(input.projectId); if (!state.ok) return state;
    if (state.value.currentEpisode === undefined) return coreErr("state_conflict");
    const memory = this.readMemory(input.projectId, PAGE); if (!memory.ok) return memory;
    if (memory.value.workingMemory.nextCursor !== undefined) return coreErr("state_conflict");
    const selected = new Set(input.selectedMemoryItemIds);
    if (selected.size !== input.selectedMemoryItemIds.length) return coreErr("invalid_input");
    const knownMemory = new Set(memory.value.workingMemory.items.map((item) => item.id));
    if (input.selectedMemoryItemIds.some((id) => !knownMemory.has(id))) return coreErr("not_found");

    const workingMemory = [] as { id: string; version: number; kind: string; content: string; source: string; sensitivity: "public" | "project_private"; outboundPolicy: "explicit_manifest_only" }[];
    const excluded: { category: "working_memory" | "provider_secret" | "host_state" | "raw_conversation" | "hidden_reasoning" | "path"; id?: string; reason: string; source: string; sensitivity: "public" | "project_private" | "secret_never_send" }[] = [
      { category: "provider_secret", reason: "credentials_are_never_part_of_pilot_context", source: "local_secret_backend", sensitivity: "secret_never_send" },
      { category: "host_state", reason: "prior_codex_session_state_is_not_reused", source: "ephemeral_host_boundary", sensitivity: "secret_never_send" },
      { category: "raw_conversation", reason: "full_conversations_are_out_of_scope", source: "explicit_context_boundary", sensitivity: "project_private" },
      { category: "hidden_reasoning", reason: "hidden_reasoning_is_never_collected_or_sent", source: "authority_and_privacy_boundary", sensitivity: "secret_never_send" },
      { category: "path", reason: "real_local_paths_are_excluded", source: "local_first_boundary", sensitivity: "secret_never_send" },
    ];
    for (const item of memory.value.workingMemory.items) {
      const sensitivity = item.sensitivity === "public" ? "public" : item.sensitivity === "secret_never_send" ? "secret_never_send" : "project_private";
      const text = memoryText(item);
      if (selected.has(item.id) && item.manifestEligible && item.state === "active" && item.outboundPolicy === "explicit_manifest_only" && sensitivity !== "secret_never_send" && item.kind !== undefined && text !== undefined) {
        workingMemory.push({ id: item.id, version: item.version, kind: item.kind, content: text, source: `project_working_memory:${item.source?.kind ?? "user_note"}`, sensitivity, outboundPolicy: "explicit_manifest_only" });
      } else {
        const reason = item.outboundPolicy === "never_send" || sensitivity === "secret_never_send" ? "never_send"
          : !selected.has(item.id) ? "not_selected"
            : item.state === "stale" ? "stale"
              : item.state === "expired" ? "expired"
                : item.state !== "active" ? item.state
                  : text === undefined ? "path_or_unbounded_content_excluded" : "not_manifest_eligible";
        excluded.push({ category: "working_memory", id: item.id, reason, source: "project_working_memory", sensitivity });
      }
    }
    if (workingMemory.length !== input.selectedMemoryItemIds.length) {
      const ineligibleSelected = input.selectedMemoryItemIds.filter((id) => !workingMemory.some((item) => item.id === id));
      if (ineligibleSelected.length > 0) return coreErr("stale_state");
    }

    const decisionsPage = this.store.decisions.listByScope(input.projectId, undefined, PAGE); if (!decisionsPage.ok) return fromDomain(decisionsPage);
    const issuesPage = this.store.issues.listByStatus(input.projectId, undefined, PAGE); if (!issuesPage.ok) return fromDomain(issuesPage);
    const evidencePage = this.store.argumentEvidence.listByProject(input.projectId, PAGE); if (!evidencePage.ok) return fromDomain(evidencePage);
    if (decisionsPage.value.nextCursor !== undefined || issuesPage.value.nextCursor !== undefined || evidencePage.value.nextCursor !== undefined) return coreErr("state_conflict");
    const decisions = decisionsPage.value.items.filter((item) => item.status === "accepted" || item.status === "frozen").sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({ id: item.id, version: item.version, status: item.status, statement: item.statement }));
    const issues = issuesPage.value.items.toSorted((a, b) => a.id.localeCompare(b.id)).map((item) => ({ id: item.id, version: item.version, status: item.status, summary: item.summary, resolutionRecorded: item.resolution !== undefined || item.status === "waived", ...(issueReopenCondition(item.transitions) ? { reopenCondition: issueReopenCondition(item.transitions) } : {}) }));
    const evidence = evidencePage.value.items.toSorted((a, b) => a.id.localeCompare(b.id)).map((item) => ({ id: item.id, version: item.version, summary: item.summary, source: `kernel_argument_evidence:${item.source.authority}`, sensitivity: "project_private" as const }));
    const canonicalState = {
      projectId: input.projectId,
      brief: state.value.brief,
      episode: state.value.currentEpisode,
      decisions: decisions.map(({ id, version, status }) => ({ id, version, status })),
      issues: issues.map(({ id, version, status, resolutionRecorded }) => ({ id, version, status, resolutionRecorded })),
      evidence: evidence.map(({ id, version }) => ({ id, version })),
    };
    const stateHash = stableResearchHash(canonicalState); if (!stateHash.ok) return coreErr("infrastructure_failure");
    const changed = prepareClosedPilotContext(pilot.value, {
      expectedVersion: pilot.value.version,
      kind: input.kind,
      projectStateHash: stateHash.value,
      brief: { id: state.value.brief.id, versionId: state.value.brief.versionId, version: state.value.brief.versionNumber, projectQuestion: state.value.brief.projectQuestion },
      episode: { id: state.value.currentEpisode.id, version: state.value.currentEpisode.version, status: state.value.currentEpisode.status },
      currentTask: state.value.brief.currentTask,
      decisions, issues, evidence, workingMemory, excluded,
      disclosure: {
        externalModelServiceMayBeCalled: input.externalModelServiceMayBeCalled,
        hostCan: ["read_the_exact_confirmed_manifest_payload", "return_one_strict_structured_result"],
        hostCannot: ["write_project_files", "mutate_sestina_state", "change_user_authority", "reuse_prior_session_state", "retry_automatically"],
        timeoutMs: input.timeoutMs,
        outputLimitBytes: input.outputLimitBytes,
      },
      confirmationExpiresAt: input.confirmationExpiresAt,
      actor: input.actor,
    }, this.ports);
    return changed.ok ? fromDomain(this.store.closedExternalAppPilots.compareAndSwap(changed.value, pilot.value.version)) : fromDomain(changed);
  }

  confirm(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly attemptId: string; readonly manifestId: string; readonly manifestHash: string; readonly confirmationNonce: string; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => confirmClosedPilotContext(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  start(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly attemptId: string; readonly manifestHash: string }): CoreResult<ClosedExternalAppPilot> {
    const currentState = this.readState(input.projectId); if (!currentState.ok) return currentState;
    const pilot = this.get(input.projectId, input.pilotId); if (!pilot.ok) return pilot;
    const manifest = pilot.value.manifests.find((item) => item.attemptId === input.attemptId);
    const currentEpisode = currentState.value.currentEpisode;
    if (currentEpisode === undefined || manifest?.payloadHash !== input.manifestHash || manifest.payload.brief.versionId !== currentState.value.brief.versionId || manifest.payload.episode.id !== currentEpisode.id || manifest.payload.episode.version !== currentEpisode.version) return coreErr("stale_state");
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (value) => startClosedPilotAttempt(value, { ...input, expectedVersion: value.version }, this.ports));
  }

  running(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly attemptId: string; readonly invocationId: string }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => markClosedPilotAttemptRunning(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  receiveCandidate(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly attemptId: string; readonly invocationId: string; readonly manifestHash: string; readonly mcpObservation: ClosedPilotMcpObservation; readonly candidate: ClosedPilotCandidateInput; readonly stdoutBytes?: number; readonly stderrBytes?: number; readonly usage?: { readonly inputTokens: number; readonly outputTokens: number } | "unavailable" }): CoreResult<ClosedExternalAppPilot> {
    const current = this.get(input.projectId, input.pilotId); if (!current.ok) return current;
    const committed = this.store.unitOfWork.commit(() => {
      const received = receiveClosedPilotCandidate(current.value, { ...input, expectedVersion: current.value.version }, this.ports); if (!received.ok) return received;
      const first = this.store.closedExternalAppPilots.compareAndSwap(received.value, current.value.version); if (!first.ok) return first;
      const required = requireClosedPilotCandidateConfirmation(first.value, { expectedVersion: first.value.version }, this.ports); if (!required.ok) return required;
      return this.store.closedExternalAppPilots.compareAndSwap(required.value, first.value.version);
    });
    return fromDomain(committed);
  }

  importCandidate(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => importClosedPilotCandidate(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  rejectCandidate(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => rejectClosedPilotCandidate(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  bindReview(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly reviewId: string; readonly importedRevisionId: string; readonly reviewMode: "ledger_only" | "provider_assisted" }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => bindClosedPilotReview(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  restoreReview(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly reviewId: string; readonly reviewMode: "ledger_only" | "provider_assisted"; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => restoreClosedPilotReview(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  bindDisposition(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly reviewId: string; readonly receiptId: string; readonly traceId: string; readonly disposition: "accept" | "reject" | "modify" | "defer" | "waive" | "rollback" | "other"; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => bindClosedPilotDisposition(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  completeContinuity(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly attemptId: string; readonly invocationId: string; readonly manifestHash: string; readonly observation: ClosedPilotContinuityObservation }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => completeClosedPilotContinuity(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  cancel(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly attemptId: string; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => cancelClosedPilotAttempt(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  fail(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly attemptId: string; readonly failureCode: ClosedPilotFailureCode; readonly publicReason: string }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => failClosedPilotAttempt(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  stale(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly publicReason: string }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => markClosedPilotStale(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  expire(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => expireClosedPilotConfirmation(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  feedback(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly codes: readonly ClosedPilotFeedbackCode[]; readonly note?: string; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => recordClosedPilotFeedback(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  close(input: { readonly projectId: string; readonly pilotId: string; readonly expectedVersion: number; readonly actor: ResearchActor }): CoreResult<ClosedExternalAppPilot> {
    return this.change(input.projectId, input.pilotId, input.expectedVersion, (pilot) => closeClosedExternalAppPilot(pilot, { ...input, expectedVersion: pilot.version }, this.ports));
  }

  exportEvidence(projectId: string, pilotId: string): CoreResult<ClosedPilotEvidenceExport> {
    const pilot = this.get(projectId, pilotId); return pilot.ok ? fromDomain(createClosedPilotEvidenceExport(pilot.value)) : pilot;
  }

  recoverInterrupted(): CoreResult<number> {
    const projects = this.store.projects.list(PAGE); if (!projects.ok) return fromDomain(projects);
    if (projects.value.nextCursor !== undefined) return coreErr("state_conflict");
    let recovered = 0;
    for (const project of projects.value.items) {
      const pilots = this.store.closedExternalAppPilots.listByProject(project.id, PAGE, ["launching", "running", "continuity_check_running"]); if (!pilots.ok) return fromDomain(pilots);
      if (pilots.value.nextCursor !== undefined) return coreErr("state_conflict");
      for (const pilot of pilots.value.items) {
        const changed = recoverInterruptedClosedPilot(pilot, { expectedVersion: pilot.version }, this.ports); if (!changed.ok) return fromDomain(changed);
        const stored = this.store.closedExternalAppPilots.compareAndSwap(changed.value, pilot.version); if (!stored.ok) return fromDomain(stored);
        recovered += 1;
      }
    }
    return coreOk(recovered);
  }

  private change(projectId: string, pilotId: string, expectedVersion: number, mutate: (pilot: ClosedExternalAppPilot) => ResearchResult<ClosedExternalAppPilot>): CoreResult<ClosedExternalAppPilot> {
    const current = this.get(projectId, pilotId); if (!current.ok) return current;
    if (current.value.version !== expectedVersion) return coreErr("stale_state");
    const changed = mutate(current.value); return changed.ok ? fromDomain(this.store.closedExternalAppPilots.compareAndSwap(changed.value, current.value.version)) : fromDomain(changed);
  }

  private get ports(): { readonly clock: Clock; readonly idFactory: IdFactory } { return { clock: this.clock, idFactory: this.idFactory }; }
}
