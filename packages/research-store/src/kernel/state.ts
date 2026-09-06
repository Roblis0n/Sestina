import {
  KernelFault,
  freezeKernel,
  kernelCanonicalJson,
  kernelHash,
  kernelId,
  kernelInteger,
  kernelText,
  kernelRecord,
  parseKernelBriefMetadata,
  kernelSha,
  kernelTime,
  parseKernelEvent,
  parseKernelReview,
  parseResearchProject,
  parseResearchArtifact,
  parseArtifactRevision,
  parseResearchBrief,
  parseResearchDecision,
  parseResearchIssue,
  parseRevisionEpisode,
  parseResearchSnapshot,
  parseArgumentClaim,
  parseArgumentEvidence,
  parseMechanismLink,
  parseArgumentDelta,
  parseClaimEvidenceLink,
  parseMechanismEvidenceLink,
  parseProjectWorkingMemory,
  type KernelHead,
  type KernelEvent,
  type KernelObjectRef,
  type KernelJson,
  type ResearchResult,
} from "@sestina/research";
import { withReadSnapshot, type StorageDatabase } from "@sestina/storage";
import { validateKernelBriefMetadata } from "./brief-metadata.js";

function textField(value: unknown): string {
  if (typeof value !== "string") throw new KernelFault("corrupt_state");
  return value;
}
type Parser = (data: unknown) => ResearchResult<unknown>;
export const CANONICAL_OBJECT_TABLES: readonly {
  table: string;
  id: string;
  kind: string;
  parser: Parser;
}[] = [
  {
    table: "research_projects",
    id: "project_id",
    kind: "project",
    parser: parseResearchProject,
  },
  {
    table: "research_artifacts",
    id: "artifact_id",
    kind: "artifact",
    parser: parseResearchArtifact,
  },
  {
    table: "artifact_revisions",
    id: "revision_id",
    kind: "revision",
    parser: parseArtifactRevision,
  },
  {
    table: "research_briefs",
    id: "brief_id",
    kind: "brief",
    parser: parseResearchBrief,
  },
  {
    table: "research_decisions",
    id: "decision_id",
    kind: "decision",
    parser: parseResearchDecision,
  },
  {
    table: "research_issues",
    id: "issue_id",
    kind: "issue",
    parser: parseResearchIssue,
  },
  {
    table: "revision_episodes",
    id: "episode_id",
    kind: "episode",
    parser: parseRevisionEpisode,
  },
  {
    table: "research_snapshots",
    id: "snapshot_id",
    kind: "snapshot",
    parser: parseResearchSnapshot,
  },
  {
    table: "argument_claims",
    id: "claim_id",
    kind: "claim",
    parser: parseArgumentClaim,
  },
  {
    table: "argument_evidence",
    id: "evidence_id",
    kind: "evidence",
    parser: parseArgumentEvidence,
  },
  {
    table: "argument_mechanism_links",
    id: "mechanism_link_id",
    kind: "mechanism",
    parser: parseMechanismLink,
  },
  {
    table: "argument_deltas",
    id: "delta_id",
    kind: "delta",
    parser: parseArgumentDelta,
  },
  {
    table: "argument_claim_evidence_links",
    id: "claim_id || ':' || evidence_id",
    kind: "claim_evidence_link",
    parser: parseClaimEvidenceLink,
  },
  {
    table: "argument_mechanism_evidence_links",
    id: "mechanism_link_id || ':' || evidence_id",
    kind: "mechanism_evidence_link",
    parser: parseMechanismEvidenceLink,
  },
  {
    table: "project_working_memory",
    id: "item_id",
    kind: "memory",
    parser: parseProjectWorkingMemory,
  },
];
export interface KernelStateObject extends KernelObjectRef {
  readonly data: Readonly<Record<string, KernelJson>>;
}
export interface KernelCanonicalState {
  readonly projectId: string;
  readonly objects: readonly KernelStateObject[];
  readonly outcomes: readonly KernelJson[];
  readonly metadata: readonly KernelJson[];
}
export interface KernelSnapshot {
  readonly head: KernelHead;
  readonly state: KernelCanonicalState;
}
export function decodeKernelJson(raw: unknown): unknown {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 8_388_608)
    throw new KernelFault("corrupt_state");
  try {
    const value: unknown = JSON.parse(raw);
    kernelCanonicalJson(value);
    return value;
  } catch {
    throw new KernelFault("corrupt_state");
  }
}

/** Canonical content only; excludes workflow, indexes, receipts and event proof. */
export function readCanonicalState(
  db: StorageDatabase,
  projectId: string,
): KernelCanonicalState {
  kernelId(projectId, "rprj_");
  const objects: KernelStateObject[] = [];
  for (const { table, id, kind, parser } of CANONICAL_OBJECT_TABLES) {
    for (const row of db.all<{
      object_id: string;
      data: string;
      version?: number;
    }>(
      `SELECT ${id} AS object_id,* FROM ${table} WHERE project_id=? ORDER BY ${id}`,
      projectId,
    )) {
      const parsed = parser(decodeKernelJson(row.data));
      if (!parsed.ok) throw new KernelFault("corrupt_state");
      const data = parsed.value as Record<string, KernelJson>;
      if (row.version !== undefined && row.version !== data.version)
        throw new KernelFault("corrupt_state");
      if (
        (kind === "project" ? data.id : data.projectId) !== projectId ||
        (!kind.endsWith("_link") && data.id !== row.object_id)
      )
        throw new KernelFault("corrupt_state");
      objects.push({
        kind,
        id: row.object_id,
        version: typeof data.version === "number" ? data.version : 1,
        data,
      });
    }
  }
  if (objects.filter((o) => o.kind === "project").length !== 1)
    throw new KernelFault("relation_mismatch");
  validateKernelBriefMetadata(db, projectId);
  // The aggregate's transition array and its materialized history must agree.
  for (const [table, kind, column] of [
    ["research_decision_transitions", "decision", "decision_id"],
    ["research_issue_transitions", "issue", "issue_id"],
  ] as const) {
    for (const obj of objects.filter((o) => o.kind === kind)) {
      const transitions = db
        .all<{ data: string }>(
          `SELECT data FROM ${table} WHERE project_id=? AND ${column}=? ORDER BY transition_index`,
          projectId,
          obj.id,
        )
        .map((r) => decodeKernelJson(r.data));
      if (kernelHash(transitions) !== kernelHash(obj.data.transitions))
        throw new KernelFault("corrupt_state");
    }
  }
  const outcomes = db
    .all<{ data: string }>(
      "SELECT data FROM research_reviews WHERE project_id=? AND status IN ('committed','disposed') ORDER BY review_id",
      projectId,
    )
    .map((r) => {
      const review = parseKernelReview(decodeKernelJson(r.data));
      return {
        id: review.id,
        createdAt: review.updatedAt,
        outcome: review.terminalOutcome,
        effectId: review.effectDraft?.effectId ?? null,
      } as unknown as KernelJson;
    });
  const metadata: KernelJson[] = [];
  for (const table of [
    "research_brief_metadata",
    "research_memory_metadata",
    "research_privacy_redactions",
  ]) {
    const rows = db.all(`SELECT * FROM ${table} WHERE project_id=?`, projectId);
    rows.sort((a, b) =>
      kernelCanonicalJson(a) < kernelCanonicalJson(b)
        ? -1
        : kernelCanonicalJson(a) > kernelCanonicalJson(b)
          ? 1
          : 0,
    );
    metadata.push({ table, rows: rows as KernelJson[] });
  }
  objects.sort((a, b) =>
    a.kind < b.kind
      ? -1
      : a.kind > b.kind
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
  return freezeKernel({ projectId, objects, outcomes, metadata });
}

export function readKernelHead(
  db: StorageDatabase,
  projectId: string,
): KernelHead {
  kernelId(projectId, "rprj_");
  const row = db.get<{
    project_id: string;
    revision: number;
    canonical_hash: string;
    event_id: string;
    updated_at: string;
  }>(
    "SELECT * FROM research_project_state_heads WHERE project_id=?",
    projectId,
  );
  if (!row) throw new KernelFault("corrupt_state");
  kernelInteger(row.revision);
  kernelSha(row.canonical_hash);
  kernelId(row.event_id, "rpev_");
  kernelTime(row.updated_at);
  return freezeKernel({
    projectId: row.project_id,
    revision: row.revision,
    canonicalHash: row.canonical_hash,
    eventId: row.event_id,
    updatedAt: row.updated_at,
  });
}
export function validateKernelChain(
  db: StorageDatabase,
  projectId: string,
  state = readCanonicalState(db, projectId),
): KernelHead {
  const head = readKernelHead(db, projectId);
  const rows = db.all<{
    event_id: string;
    revision: number;
    previous_hash: string;
    next_hash: string;
    transaction_id: string;
    data: string;
  }>(
    "SELECT * FROM research_project_state_events WHERE project_id=? ORDER BY revision",
    projectId,
  );
  let previous = "0".repeat(64);
  let expected = 1;
  let eventId = "";
  for (const row of rows) {
    const event = parseKernelEvent(decodeKernelJson(row.data));
    if (
      event.projectId !== projectId ||
      event.id !== row.event_id ||
      event.revision !== row.revision ||
      event.transactionId !== row.transaction_id ||
      event.previousCanonicalHash !== row.previous_hash ||
      event.nextCanonicalHash !== row.next_hash ||
      event.revision !== expected ||
      event.previousCanonicalHash !== previous
    )
      throw new KernelFault("corrupt_state");
    previous = event.nextCanonicalHash;
    eventId = event.id;
    expected++;
  }
  if (
    head.revision !== expected - 1 ||
    head.eventId !== eventId ||
    head.canonicalHash !== previous ||
    kernelHash(state) !== head.canonicalHash
  )
    throw new KernelFault("corrupt_state");
  return head;
}
export function readKernelSnapshot(
  db: StorageDatabase,
  projectId: string,
  afterHeadRead?: () => void,
): KernelSnapshot {
  return withReadSnapshot(db, () => {
    const head = readKernelHead(db, projectId);
    afterHeadRead?.();
    const state = readCanonicalState(db, projectId);
    const verified = validateKernelChain(db, projectId, state);
    if (verified.revision !== head.revision)
      throw new KernelFault("corrupt_state");
    return freezeKernel({ head, state });
  });
}
export function appendKernelEvent(
  db: StorageDatabase,
  input: KernelEvent,
): KernelEvent {
  const event = parseKernelEvent(input);
  db.run(
    "INSERT INTO research_project_state_events(event_id,project_id,revision,transaction_id,effect_kind,review_id,previous_hash,next_hash,created_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
    event.id,
    event.projectId,
    event.revision,
    event.transactionId,
    event.effectKind,
    event.reviewId,
    event.previousCanonicalHash,
    event.nextCanonicalHash,
    event.createdAt,
    kernelCanonicalJson(event),
  );
  return event;
}
export function changedKernelObjects(
  before: KernelCanonicalState,
  after: KernelCanonicalState,
): readonly KernelObjectRef[] {
  const key = (o: KernelObjectRef) => `${o.kind}:${o.id}`;
  const a = new Map(before.objects.map((o) => [key(o), o]));
  const b = new Map(after.objects.map((o) => [key(o), o]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap((k) => {
    const old = a.get(k),
      current = b.get(k);
    if (kernelHash(old ?? null) === kernelHash(current ?? null)) return [];
    const item = current ?? old;
    if (!item) throw new KernelFault("corrupt_state");
    return [{ kind: item.kind, id: item.id, version: current?.version ?? 0 }];
  });
}

export interface KernelProjectionSelection {
  readonly evidenceIds?: readonly string[];
  readonly issueIds?: readonly string[];
  readonly memory?: readonly {
    readonly id: string;
    readonly version: number;
    readonly contentHash: string;
  }[];
}
export function projectKernelContext(
  snapshot: KernelSnapshot,
  suggestion: string,
  selection: KernelProjectionSelection = {},
) {
  kernelText(suggestion, 65_536);
  kernelRecord(selection, ["evidenceIds", "issueIds", "memory"]);
  if (
    snapshot.head.projectId !== snapshot.state.projectId ||
    snapshot.head.canonicalHash !== kernelHash(snapshot.state)
  )
    throw new KernelFault("corrupt_state");
  for (const [kind, refs, prefix] of [
    ["evidence", selection.evidenceIds, "revd_"],
    ["issue", selection.issueIds, "riss_"],
  ] as const) {
    if (refs === undefined) continue;
    if (
      !Array.isArray(refs) ||
      refs.length > 1000 ||
      new Set(refs).size !== refs.length
    )
      throw new KernelFault("invalid_record");
    for (const id of refs) {
      kernelId(id, prefix);
      if (!snapshot.state.objects.some((o) => o.kind === kind && o.id === id))
        throw new KernelFault("relation_mismatch");
    }
  }
  if (
    selection.memory !== undefined &&
    (!Array.isArray(selection.memory) || selection.memory.length > 64)
  )
    throw new KernelFault("invalid_record");
  const take = (kind: string) =>
    snapshot.state.objects.filter((o) => o.kind === kind);
  const pick = (o: KernelStateObject, fields: readonly string[]) => ({
    id: o.id,
    version: o.version,
    ...Object.fromEntries(
      fields
        .filter((key) => o.data[key] !== undefined)
        .map((key) => [key, o.data[key]]),
    ),
  });
  const limitations: string[] = [];
  for (const group of snapshot.state.metadata) {
    const section = group as { table: string; rows: { data: string }[] };
    if (section.table !== "research_brief_metadata") continue;
    for (const row of section.rows) {
      const metadata = parseKernelBriefMetadata(decodeKernelJson(row.data));
      const active = metadata.versions.find(
        (v) => v.versionId === metadata.currentVersionId,
      );
      if (!active) throw new KernelFault("corrupt_state");
      for (const [field, coverage] of Object.entries(active.sections))
        if (coverage.state === "not_provided")
          limitations.push(`Brief ${field}: not_provided.`);
      limitations.push(...active.limitations);
    }
  }
  const briefs = take("brief").map((o) => {
    const versions = o.data.versions as readonly Record<string, KernelJson>[];
    const current = versions.find((v) => v.id === o.data.currentVersionId);
    if (!current) throw new KernelFault("corrupt_state");
    return Object.fromEntries(
      [
        "id",
        "version",
        "projectQuestion",
        "currentStage",
        "currentTask",
        "targetArtifacts",
        "fixedDecisions",
        "allowedChanges",
        "forbiddenChanges",
        "expectedDeltas",
        "evidenceBoundaries",
        "explicitNonGoals",
      ]
        .filter((k) => current[k] !== undefined)
        .map((k) => [k, current[k]]),
    );
  });
  if (briefs.length === 0) limitations.push("Brief not provided.");
  limitations.push(
    "Provider semantic correctness is unproven; Memory is context, not Evidence.",
  );
  const selectedEvidence = new Set(selection.evidenceIds ?? []);
  const selectedIssues =
    selection.issueIds === undefined ? null : new Set(selection.issueIds);
  const evidence = take("evidence").filter((o) => selectedEvidence.has(o.id));
  if (evidence.length !== selectedEvidence.size)
    throw new KernelFault("relation_mismatch");
  const memory = (selection.memory ?? [])
    .map((ref: NonNullable<KernelProjectionSelection["memory"]>[number]) => {
      const obj = take("memory").find((o) => o.id === ref.id);
      if (
        obj?.version !== ref.version ||
        obj.data.contentHash !== ref.contentHash ||
        obj.data.state !== "active" ||
        obj.data.outboundPolicy !== "explicit_manifest_only" ||
        obj.data.sensitivity === "secret_never_send"
      )
        throw new KernelFault("stale_object");
      return pick(obj, ["kind", "content", "contentHash"]);
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(memory.map((m) => m.id)).size !== memory.length)
    throw new KernelFault("invalid_record");
  const episodes = take("episode").filter(
    (o) =>
      !["accepted", "rejected", "abandoned"].includes(textField(o.data.status)),
  );
  episodes.sort((a, b) =>
    textField(a.data.createdAt) < textField(b.data.createdAt)
      ? 1
      : textField(a.data.createdAt) > textField(b.data.createdAt)
        ? -1
        : a.id < b.id
          ? -1
          : 1,
  );
  const categories = [
    { kind: "brief", items: briefs },
    {
      kind: "decisions",
      items: take("decision")
        .filter((o) =>
          ["accepted", "frozen"].includes(textField(o.data.status)),
        )
        .map((o) => pick(o, ["statement", "scope", "status", "rationale"])),
    },
    {
      kind: "issues",
      items: take("issue")
        .filter((o) =>
          selectedIssues
            ? selectedIssues.has(o.id)
            : !["resolved", "suppressed", "waived"].includes(
                textField(o.data.status),
              ),
        )
        .map((o) => pick(o, ["kind", "status", "summary", "target"])),
    },
    {
      kind: "evidence",
      items: evidence.map((o) =>
        pick(o, [
          "kind",
          "state",
          "summary",
          "provenance",
          "inferenceCapacity",
          "sourceRefs",
          "source",
          "artifactId",
          "revisionId",
          "contentVersionHash",
        ]),
      ),
    },
    {
      kind: "current_episode",
      items: episodes
        .slice(0, 1)
        .map((o) =>
          pick(o, [
            "status",
            "artifactId",
            "baselineRevisionId",
            "candidateRevisionId",
          ]),
        ),
    },
    { kind: "suggestion", text: suggestion.normalize("NFC") },
    { kind: "selected_memory", items: memory },
    { kind: "limitations", items: limitations },
    {
      kind: "outcome_summaries",
      items: [...snapshot.state.outcomes]
        .sort((a, b) => {
          const left = a as { id: string; createdAt: string },
            right = b as { id: string; createdAt: string };
          return left.createdAt < right.createdAt
            ? 1
            : left.createdAt > right.createdAt
              ? -1
              : left.id < right.id
                ? -1
                : 1;
        })
        .slice(0, 32)
        .sort((a, b) =>
          (a as { id: string }).id < (b as { id: string }).id ? -1 : 1,
        ),
    },
  ];
  const projection = freezeKernel({
    schemaVersion: "1.0.0",
    policyVersion: "1.0.0",
    projectId: snapshot.head.projectId,
    projectStateRevision: snapshot.head.revision,
    categories,
  });
  return freezeKernel({
    projection,
    contextProjectionHash: kernelHash(projection),
    limitations,
    excludedFields: [
      "raw_receipts",
      "traces",
      "full_history",
      "provider_raw_output",
      "secrets",
      "session_capabilities",
      "absolute_paths",
      "hidden_reasoning",
      "unselected_memory",
      "never_send_memory",
      "other_projects",
    ],
  });
}
