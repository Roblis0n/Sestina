import {
  KernelFault,
  KERNEL_TERMINAL_STATES,
  kernelHash,
  kernelInteger,
  kernelRecord,
  kernelText,
  type KernelJson,
} from "@sestina/research";
import type { KernelWorkspaceSnapshot } from "@sestina/research-store";
import { projectBrief, kernelObjectLabels } from "./kernel-brief.js";
import { projectMemory } from "./kernel-memory.js";

export interface WorkspaceEntry {
  id: string;
  kind: string;
  title: string;
  status: string;
  source: string;
  version: number;
  revision: number;
  at: string;
  href: string;
  summary: string;
  reason: string;
  actions: string[];
  related: string[];
}
/** Resume and Review use the same captured records and the same next-action projection. */
export function projectWorkspaceReview(
  snapshot: KernelWorkspaceSnapshot,
  id: string,
) {
  const review = snapshot.workflows.reviews.find((row) => row.id === id);
  if (!review) throw new KernelFault("relation_mismatch");
  const terminal = KERNEL_TERMINAL_STATES.includes(review.status),
    stale =
      !terminal && review.baseProjectStateRevision !== snapshot.head.revision;
  const manifest = snapshot.workflows.manifests.find(
    (row) => row.id === review.manifestId,
  );
  const allowedNext = terminal
    ? ["continue_review"]
    : stale || review.status === "stale"
      ? ["rebuild_manifest", "read", "cancel"]
      : review.status === "draft"
        ? ["edit", "prepare_manifest", "skip_assessment", "cancel"]
        : review.status === "provider_attempt_running"
          ? ["cancel_attempt", "read"]
          : review.status === "manifest_prepared"
            ? ["confirm_manifest", "cancel", "rebuild_manifest"]
            : review.status === "provider_attempt_prepared"
              ? ["start_attempt", "cancel", "rebuild_manifest"]
              : [
                  "prepare_effect",
                  "skip_assessment",
                  "rebuild_manifest",
                  "cancel",
                  ...(review.status === "manifest_confirmed" &&
                  manifest?.provider
                    ? ["prepare_attempt"]
                    : []),
                  ...(review.effectDraft &&
                  !review.effectDraft.invalidated &&
                  [
                    "manifest_confirmed",
                    "assessment_recorded",
                    "provider_attempt_failed",
                    "provider_attempt_uncertain",
                  ].includes(review.status)
                    ? ["commit"]
                    : []),
                ];
  return {
    review,
    projectStateRevision: snapshot.head.revision,
    staleReasons: [
      ...new Set([
        ...(stale ? ["project_revision_changed"] : []),
        ...(review.staleReason ? review.staleReason.split(",") : []),
      ]),
    ],
    attempts: snapshot.workflows.attempts.filter((row) =>
      review.attemptIds.includes(row.id),
    ),
    corrections: snapshot.workflows.corrections.filter(
      (row) => row.reviewId === id,
    ),
    manifest: manifest
      ? Object.fromEntries(
          Object.entries(manifest).filter(
            ([key]) => key !== "exactRequestBody",
          ),
        )
      : null,
    allowedNext,
  };
}
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const excerpt = (v: string, query = "") => {
  const start = Math.max(
    0,
    v.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 70,
  );
  return (
    (start ? "…" : "") +
    v.slice(start, start + 360) +
    (v.length > start + 360 ? "…" : "")
  );
};
// Index only user-visible research fields. Never recursively serialize persisted records.
function content(data: Readonly<Record<string, KernelJson>>): string {
  const fields = new Set([
    "title",
    "name",
    "question",
    "projectQuestion",
    "currentTask",
    "statement",
    "description",
    "summary",
    "reason",
    "rationale",
    "content",
    "text",
    "resolutionNote",
    "publicReason",
    "inferenceCapacity",
    "reopenConditions",
    "boundary",
    "constraint",
    "label",
  ]);
  const containers = new Set([
    "progressive",
    "sections",
    "constraints",
    "assumptions",
    "nonGoals",
    "researchQuestions",
    "knownFacts",
    "openQuestions",
    "successCriteria",
    "scope",
    "limitations",
  ]);
  function scan(value: KernelJson, depth = 0): string[] {
    if (depth > 8 || !value || typeof value !== "object") return [];
    if (Array.isArray(value))
      return (value as readonly KernelJson[]).flatMap((v) =>
        typeof v === "string" ? [v] : scan(v, depth + 1),
      );
    return Object.entries(value).flatMap(([key, v]) =>
      fields.has(key) && typeof v === "string"
        ? [v]
        : containers.has(key)
          ? scan(v, depth + 1)
          : [],
    );
  }
  return scan(data).join("\n");
}
export function projectKernelWorkspace(
  snapshot: KernelWorkspaceSnapshot,
  input: unknown,
) {
  const q = kernelRecord(input, [
    "view",
    "query",
    "kind",
    "status",
    "source",
    "from",
    "to",
    "minRevision",
    "maxRevision",
    "cursor",
    "limit",
    "id",
  ]);
  const view = q.view ?? "today";
  kernelText(view, 32);
  if (
    ![
      "today",
      "attention",
      "resume",
      "project",
      "search",
      "history",
      "receipt",
      "object",
    ].includes(view)
  )
    throw new KernelFault("invalid_record");
  const limit = q.limit ?? 30;
  kernelInteger(limit);
  if (limit < 1 || limit > 100) throw new KernelFault("invalid_record");
  for (const name of [
    "query",
    "kind",
    "status",
    "source",
    "from",
    "to",
    "id",
  ] as const)
    if (q[name] !== undefined)
      kernelText(q[name], name === "query" ? 1024 : 180);
  const query = text(q.query).trim().toLocaleLowerCase();
  const labels = kernelObjectLabels(snapshot),
    brief = projectBrief(snapshot);
  const refs = new Map<string, string[]>();
  const origins = new Map<string, { revision: number; at: string }>();
  for (const event of snapshot.workflows.events)
    for (const ref of event.changedObjectRefs) {
      if ((origins.get(ref.id)?.revision ?? 0) < event.revision)
        origins.set(ref.id, { revision: event.revision, at: event.createdAt });
    }
  for (const receipt of snapshot.workflows.receipts)
    for (const ref of receipt.resultingObjects) {
      refs.set(ref.id, [
        ...(refs.get(ref.id) ?? []),
        ...(receipt.reviewId ? [receipt.reviewId] : []),
      ]);
    }
  const objects: WorkspaceEntry[] = snapshot.state.objects
    .filter((o) => !["project", "memory"].includes(o.kind))
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      title:
        labels[o.id] ??
        (text(o.data.title) || text(o.data.statement) || o.kind),
      status: text(o.data.status) || text(o.data.state) || "current",
      source: "canonical",
      version: o.version,
      revision: origins.get(o.id)?.revision ?? 1,
      at:
        origins.get(o.id)?.at ??
        (text(o.data.updatedAt) || text(o.data.createdAt)),
      href: `/project/state?object=${encodeURIComponent(o.id)}`,
      summary:
        o.kind === "brief"
          ? content(
              (brief.active ?? {}) as unknown as Record<string, KernelJson>,
            )
          : content(o.data),
      reason: "research_object",
      actions: ["view_object"],
      related: refs.get(o.id) ?? [],
    }));
  const reviews: WorkspaceEntry[] = snapshot.workflows.reviews.map((r) => ({
    id: r.id,
    kind: "review",
    title: r.suggestion || "Content removed",
    status: r.status,
    source: r.source.kind,
    version: r.version,
    revision: r.baseProjectStateRevision,
    at: r.updatedAt,
    href: `/project/reviews/${encodeURIComponent(r.id)}`,
    summary: r.suggestion,
    reason:
      r.baseProjectStateRevision !== snapshot.head.revision &&
      !KERNEL_TERMINAL_STATES.includes(r.status)
        ? "recheck_context"
        : r.status,
    actions: KERNEL_TERMINAL_STATES.includes(r.status)
      ? ["view_result", "continue_review"]
      : r.status === "provider_attempt_uncertain"
        ? ["inspect_attempt", "continue_without_assessment"]
        : ["resume_review"],
    related: r.terminalOutcome?.receiptId ? [r.terminalOutcome.receiptId] : [],
  }));
  const receipts: WorkspaceEntry[] = snapshot.workflows.receipts.map((r) => ({
    id: r.id,
    kind: "receipt",
    title: r.effectKind,
    status: "saved",
    source: "kernel_receipt",
    version: 1,
    revision: r.afterProjectStateRevision,
    at: r.createdAt,
    href: `/project/history/receipt/${encodeURIComponent(r.id)}`,
    summary: r.publicReason,
    reason: "saved_result",
    actions: ["view_result"],
    related: [
      ...(r.reviewId ? [r.reviewId] : []),
      ...r.resultingObjects.map((o) => o.id),
    ],
  }));
  const corrections: WorkspaceEntry[] = snapshot.workflows.corrections.map(
    (c) => ({
      id: c.id,
      kind: "correction",
      title: c.publicReason,
      status: "recorded",
      source: "review_correction",
      version: c.version,
      revision: snapshot.head.revision,
      at: c.createdAt,
      href: `/project/reviews/${encodeURIComponent(c.reviewId)}`,
      summary: c.publicReason,
      reason: "linked_correction",
      actions: ["view_review"],
      related: [
        c.reviewId,
        ...(c.continuationReviewId ? [c.continuationReviewId] : []),
      ],
    }),
  );
  const legacy: WorkspaceEntry[] = snapshot.legacy.map((r) => ({
    id: r.source_id,
    kind: "legacy",
    title: r.source_kind,
    status: r.classification,
    source: r.source_kind,
    version: 1,
    revision: 1,
    at: r.at,
    href: `/project/history/${encodeURIComponent(r.source_kind)}/${encodeURIComponent(r.source_id)}`,
    summary: r.summary,
    reason: "historical_record_only",
    actions: ["view_history", "export", "convert_to_draft"],
    related: [],
  }));
  const memory = projectMemory(snapshot, snapshot.evaluatedAt)
    .filter(
      (m) =>
        m.recallEligible &&
        m.item.state !== "forgotten" &&
        m.item.sensitivity !== "secret_never_send",
    )
    .map((m) => ({
      id: m.item.id,
      kind: "memory",
      title: m.item.state === "forgotten" ? "" : m.item.kind,
      status: m.userState,
      source: "context_only",
      version: m.item.version,
      revision: snapshot.head.revision,
      at: m.item.state === "forgotten" ? "" : m.item.updatedAt,
      href: "/project/state?context=1",
      summary: "",
      reason: "context_not_evidence",
      actions: ["view_context"],
      related: [],
    }));
  const attention = [
    ...reviews.filter(
      (r) =>
        !["committed", "disposed", "cancelled", "failed"].includes(r.status),
    ),
    ...objects
      .filter(
        (o) =>
          o.kind === "issue" &&
          !["resolved", "waived", "closed"].includes(o.status),
      )
      .map((o) => ({
        ...o,
        reason: "open_issue",
        actions: ["view_object", "start_review"],
      })),
  ];
  let rows: WorkspaceEntry[] =
    view === "project" || view === "object"
      ? objects
      : view === "resume"
        ? reviews
        : view === "attention"
          ? attention
          : view === "today"
            ? attention
            : view === "history" || view === "receipt"
              ? [...receipts, ...corrections, ...reviews, ...legacy]
              : [
                  ...objects,
                  ...reviews,
                  ...receipts,
                  ...corrections,
                  ...legacy,
                  ...memory,
                ];
  if (q.id !== undefined) rows = rows.filter((r) => r.id === q.id);
  for (const field of ["kind", "status", "source"] as const)
    if (q[field]) rows = rows.filter((r) => r[field] === q[field]);
  if (q.from) rows = rows.filter((r) => r.at >= String(q.from));
  if (q.to) rows = rows.filter((r) => r.at <= String(q.to));
  for (const key of ["minRevision", "maxRevision"] as const)
    if (q[key] !== undefined) kernelInteger(q[key], 0);
  if (typeof q.minRevision === "number")
    rows = rows.filter((r) => r.revision >= (q.minRevision as number));
  if (typeof q.maxRevision === "number")
    rows = rows.filter((r) => r.revision <= (q.maxRevision as number));
  if (query)
    rows = rows.filter((r) =>
      `${r.title}\n${r.summary}`.toLocaleLowerCase().includes(query),
    );
  rows.sort(
    (a, b) =>
      b.at.localeCompare(a.at) ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
  const binding = kernelHash({
    inputHash: snapshot.inputHash,
    ...q,
    cursor: null,
  });
  let offset = 0;
  if (q.cursor !== undefined) {
    kernelText(q.cursor, 180);
    const parts = q.cursor.split(":");
    if (
      parts[0] !== binding ||
      parts.length !== 2 ||
      !/^\d+$/.test(parts[1] ?? "")
    )
      throw new KernelFault("stale_revision");
    offset = Number(parts[1]);
    if (!Number.isSafeInteger(offset) || offset > rows.length)
      throw new KernelFault("invalid_record");
  }
  const items = rows.slice(offset, offset + limit).map((r) => ({
    ...r,
    title: excerpt(r.title),
    summary: excerpt(r.summary, query),
    matchReason: query
      ? r.title.toLocaleLowerCase().includes(query)
        ? "title"
        : "content"
      : null,
  }));
  const receipt = q.id
    ? snapshot.workflows.receipts.find((r) => r.id === q.id)
    : undefined;
  const object = q.id
    ? snapshot.state.objects.find((o) => o.id === q.id && o.kind !== "memory")
    : undefined;
  const relatedObjects = object
    ? snapshot.state.objects
        .filter(
          (candidate) =>
            candidate.id !== object.id &&
            candidate.kind !== "memory" &&
            Object.entries(candidate.data).some(
              ([key, value]) =>
                [
                  "claimId",
                  "evidenceId",
                  "mechanismId",
                  "decisionId",
                  "issueId",
                  "episodeId",
                  "sourceArtifactId",
                  "artifactId",
                  "revisionId",
                  "sourceRevisionId",
                ].includes(key) && value === object.id,
            ),
        )
        .map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          version: candidate.version,
          title: excerpt(labels[candidate.id] ?? candidate.kind),
          href: `/project/state?object=${encodeURIComponent(candidate.id)}`,
        }))
    : [];
  if (q.id && !rows.length) throw new KernelFault("relation_mismatch");
  return {
    ...snapshot.identity,
    inputHash: snapshot.inputHash,
    evaluatedAt: snapshot.evaluatedAt,
    status: "ready" as const,
    indexMode: "snapshot" as const,
    view,
    items,
    total: rows.length,
    nextCursor:
      offset + limit < rows.length ? `${binding}:${offset + limit}` : null,
    brief: {
      question: brief.active?.projectQuestion ?? "",
      task: brief.active?.currentTask ?? "",
      id: brief.brief?.id ?? null,
    },
    recent:
      view === "today"
        ? receipts.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
        : [],
    detail:
      view === "resume" && q.id
        ? projectWorkspaceReview(snapshot, text(q.id))
        : view === "receipt"
          ? (receipt ?? null)
          : view === "object" && object
            ? {
                ...object,
                sourceProjectStateRevision:
                  origins.get(object.id)?.revision ?? 1,
                reviewIds: refs.get(object.id) ?? [],
                relatedObjects,
              }
            : null,
  };
}
