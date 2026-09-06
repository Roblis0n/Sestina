import {
  KernelFault,
  KERNEL_TERMINAL_STATES,
  kernelCanonicalJson,
  kernelHash,
  kernelId,
  kernelInteger,
  parseKernelReview,
  parseKernelAttempt,
  parseKernelManifest,
  parseKernelCorrection,
  parseKernelReceipt,
  parseKernelEvent,
  type KernelReview,
  type KernelAttempt,
  type KernelManifest,
  type KernelCorrection,
  type KernelReceipt,
  type KernelEvent,
  type KernelPage,
  type KernelPageRequest,
  type KernelReader,
  type KernelRepository,
  type KernelRepositories,
} from "@sestina/research";
import { withTransaction, type StorageDatabase } from "@sestina/storage";
import {
  decodeKernelJson,
  readKernelHead,
  validateKernelChain,
} from "./state.js";

type Item =
  | KernelReview
  | KernelAttempt
  | KernelManifest
  | KernelCorrection
  | KernelReceipt
  | KernelEvent;
interface Descriptor<T extends Item> {
  table: string;
  id: string;
  parse: (value: unknown) => T;
}

/** Validate persisted columns and all workflow/proof edges in one read snapshot. */
export function validateKernelRelations(
  db: StorageDatabase,
  projectId: string,
): void {
  const repos = createKernelRepositories(db);
  const collect = <T>(repository: KernelReader<T>): T[] => {
    const items: T[] = [];
    let cursor: string | undefined;
    do {
      const page = repository.listByProject(projectId, {
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  };
  const reviews = collect(repos.reviews),
    manifests = collect(repos.manifests),
    attempts = collect(repos.attempts),
    receipts = collect(repos.receipts),
    events = collect(repos.events),
    corrections = collect(repos.corrections);
  const head = repos.heads.get(projectId);
  for (const r of reviews) {
    const children = attempts
      .filter((a) => a.reviewId === r.id)
      .sort((a, b) => a.ordinal - b.ordinal);
    if (
      kernelHash(children.map((a) => a.id)) !== kernelHash(r.attemptIds) ||
      children.some((a, i) => a.ordinal !== i + 1) ||
      r.baseProjectStateRevision > head.revision
    )
      throw new KernelFault("corrupt_state");
    if (r.manifestId) {
      const m = manifests.find((m) => m.id === r.manifestId);
      if (
        m?.reviewId !== r.id ||
        m.baseProjectStateRevision !== r.baseProjectStateRevision
      )
        throw new KernelFault("corrupt_state");
    }
    const expected: Record<string, string> = {
      provider_attempt_prepared: "prepared",
      provider_attempt_running: "running",
      provider_attempt_uncertain: "uncertain",
      provider_attempt_failed: "failed",
      assessment_recorded: "completed",
    };
    if (expected[r.status] && children.at(-1)?.status !== expected[r.status])
      throw new KernelFault("corrupt_state");
    if (
      r.terminalOutcome?.receiptId &&
      !receipts.some(
        (p) => p.id === r.terminalOutcome?.receiptId && p.reviewId === r.id,
      )
    )
      throw new KernelFault("corrupt_state");
  }
  for (const m of manifests)
    if (
      !reviews.some((r) => r.id === m.reviewId) ||
      m.baseProjectStateRevision > head.revision
    )
      throw new KernelFault("corrupt_state");
  for (const a of attempts) {
    const m = manifests.find((m) => m.id === a.manifestId);
    if (
      m?.reviewId !== a.reviewId ||
      m.identityHash !== a.manifestIdentityHash ||
      m.provider === null
    )
      throw new KernelFault("corrupt_state");
  }
  for (const c of corrections) {
    const a = attempts.find((a) => a.id === c.attemptId);
    if (
      a?.reviewId !== c.reviewId ||
      a.assessmentHash !== c.originalAssessmentHash ||
      a.status !== "completed"
    )
      throw new KernelFault("corrupt_state");
  }
  const commands = db.all<{
    command_id: string;
    receipt_id: string;
    command_hash: string;
  }>(
    "SELECT command_id,receipt_id,command_hash FROM research_authority_commands WHERE project_id=?",
    projectId,
  );
  if (
    commands.length !== receipts.length ||
    events.length !== receipts.length + 1
  )
    throw new KernelFault("corrupt_state");
  for (const p of receipts) {
    const e = events.find((e) => e.id === p.revisionEventId),
      c = commands.find((c) => c.command_id === p.authorityCommandId);
    if (
      e?.revision !== p.afterProjectStateRevision ||
      e.transactionId !== p.authorityCommandId ||
      e.reviewId !== p.reviewId ||
      kernelHash(e.changedObjectRefs) !== kernelHash(p.resultingObjects) ||
      c?.receipt_id !== p.id ||
      !/^[a-f0-9]{64}$/.test(c.command_hash)
    )
      throw new KernelFault("corrupt_state");
    if (p.reviewId) {
      const r = reviews.find((r) => r.id === p.reviewId);
      if (
        r?.terminalOutcome?.receiptId !== p.id ||
        kernelHash(r.terminalOutcome.resultingObjects) !==
          kernelHash(p.resultingObjects)
      )
        throw new KernelFault("corrupt_state");
    }
  }
  const outbox = db.all<{ revision: number; event_id: string }>(
    "SELECT revision,event_id FROM research_projection_outbox WHERE project_id=?",
    projectId,
  );
  if (
    outbox.length !== events.length ||
    outbox.some(
      (o) =>
        !events.some((e) => e.id === o.event_id && e.revision === o.revision),
    )
  )
    throw new KernelFault("corrupt_state");
}
function checkedPage(
  projectId: string,
  kind: string,
  request: KernelPageRequest,
) {
  kernelId(projectId, "rprj_");
  kernelInteger(request.limit);
  if (
    request.limit > 200 ||
    Object.keys(request).some((k) => !["limit", "cursor"].includes(k))
  )
    throw new KernelFault("invalid_record");
  let after = { createdAt: "", id: "" };
  if (request.cursor !== undefined) {
    if (
      typeof request.cursor !== "string" ||
      request.cursor.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/.test(request.cursor)
    )
      throw new KernelFault("invalid_record");
    let decoded: Record<string, unknown>;
    try {
      decoded = JSON.parse(
        Buffer.from(request.cursor, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
    } catch {
      throw new KernelFault("invalid_record");
    }
    if (
      Object.keys(decoded).sort().join(",") !==
        "createdAt,id,kind,projectId,schemaVersion" ||
      decoded.schemaVersion !== "1.0.0" ||
      decoded.projectId !== projectId ||
      decoded.kind !== kind ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.id !== "string"
    )
      throw new KernelFault("invalid_record");
    after = { createdAt: decoded.createdAt, id: decoded.id };
  }
  return { limit: request.limit, after };
}
function decode<T extends Item>(
  descriptor: Descriptor<T>,
  row: Record<string, unknown>,
  projectId: string,
): T {
  const value = descriptor.parse(decodeKernelJson(row.data));
  if (
    value.projectId !== projectId ||
    value.id !== row[descriptor.id] ||
    value.createdAt !== row.created_at ||
    ("version" in value && value.version !== row.version) ||
    ("status" in value && value.status !== row.status)
  )
    throw new KernelFault("corrupt_state");
  if (
    ("baseProjectStateRevision" in value &&
      value.baseProjectStateRevision !== row.base_revision) ||
    ("reviewId" in value && value.reviewId !== row.review_id) ||
    ("manifestId" in value && value.manifestId !== row.manifest_id)
  )
    throw new KernelFault("corrupt_state");
  const columns: Record<string, string> = {
    updatedAt: "updated_at",
    suggestionHash: "suggestion_hash",
    identityHash: "identity_hash",
    ordinal: "ordinal",
    receiptHash: "receipt_hash",
    effectKind: "effect_kind",
    revision: "revision",
    transactionId: "transaction_id",
    previousCanonicalHash: "previous_hash",
    nextCanonicalHash: "next_hash",
    authorityCommandId: "authority_command_id",
    beforeProjectStateRevision: "before_revision",
    afterProjectStateRevision: "after_revision",
    revisionEventId: "event_id",
    originalAssessmentHash: "original_assessment_hash",
  };
  for (const [key, column] of Object.entries(columns))
    if (
      key in value &&
      (value as unknown as Record<string, unknown>)[key] !== row[column]
    )
      throw new KernelFault("corrupt_state");
  return value;
}
function reader<T extends Item>(
  db: StorageDatabase,
  descriptor: Descriptor<T>,
): KernelReader<T> {
  return Object.freeze({
    getById(projectId: string, id: string) {
      kernelId(projectId, "rprj_");
      if (typeof id !== "string" || id.length > 160)
        throw new KernelFault("invalid_record");
      const row = db.get(
        `SELECT * FROM ${descriptor.table} WHERE project_id=? AND ${descriptor.id}=?`,
        projectId,
        id,
      );
      return row ? decode(descriptor, row, projectId) : undefined;
    },
    listByProject(projectId: string, page: KernelPageRequest): KernelPage<T> {
      const { limit, after } = checkedPage(projectId, descriptor.table, page);
      const rows = db.all(
        `SELECT * FROM ${descriptor.table} WHERE project_id=? AND (created_at>? OR (created_at=? AND ${descriptor.id}>?)) ORDER BY created_at,${descriptor.id} LIMIT ?`,
        projectId,
        after.createdAt,
        after.createdAt,
        after.id,
        limit + 1,
      );
      const items = rows
        .slice(0, limit)
        .map((row) => decode(descriptor, row, projectId));
      const last = items.at(-1);
      const nextCursor =
        rows.length > limit && last
          ? Buffer.from(
              kernelCanonicalJson({
                schemaVersion: "1.0.0",
                projectId,
                kind: descriptor.table,
                createdAt: last.createdAt,
                id: last.id,
              }),
            ).toString("base64url")
          : undefined;
      return Object.freeze({
        items: Object.freeze(items),
        ...(nextCursor ? { nextCursor } : {}),
      });
    },
  });
}
const transitions: Readonly<
  Record<KernelReview["status"], readonly KernelReview["status"][]>
> = {
  draft: ["manifest_prepared", "cancelled"],
  manifest_prepared: ["manifest_confirmed", "cancelled"],
  manifest_confirmed: [
    "provider_attempt_prepared",
    "stale",
    "committed",
    "disposed",
    "cancelled",
  ],
  provider_attempt_prepared: ["provider_attempt_running", "cancelled"],
  provider_attempt_running: [
    "assessment_recorded",
    "provider_attempt_failed",
    "provider_attempt_uncertain",
  ],
  provider_attempt_uncertain: [
    "provider_attempt_prepared",
    "committed",
    "disposed",
  ],
  provider_attempt_failed: ["manifest_confirmed", "committed", "disposed"],
  assessment_recorded: ["stale", "committed", "disposed"],
  stale: ["manifest_prepared"],
  disposed: [],
  committed: [],
  cancelled: [],
};
export function createKernelRepositories(
  db: StorageDatabase,
): KernelRepositories {
  const reviews = reader(db, {
    table: "research_reviews",
    id: "review_id",
    parse: parseKernelReview,
  });
  const attempts = reader(db, {
    table: "research_provider_attempts",
    id: "attempt_id",
    parse: parseKernelAttempt,
  });
  const manifests = reader(db, {
    table: "context_manifests",
    id: "manifest_id",
    parse: parseKernelManifest,
  });
  const corrections = reader(db, {
    table: "research_review_corrections",
    id: "correction_id",
    parse: parseKernelCorrection,
  });
  function write<T>(projectId: string, work: () => T): T {
    return withTransaction(db, () =>
      db.withKernelWrite("workflow", () => {
        if (!db.isKernelCanonicalWrite) validateKernelChain(db, projectId);
        return work();
      }),
    );
  }
  function initial<
    T extends { version: number; projectId: string; id: string },
  >(
    item: T,
    get: (projectId: string, id: string) => T | undefined,
  ): T | undefined {
    if (item.version !== 1) throw new KernelFault("invalid_record");
    const previous = get(item.projectId, item.id);
    if (previous && kernelHash(previous) !== kernelHash(item))
      throw new KernelFault("idempotency_conflict");
    return previous;
  }
  function next<
    T extends {
      version: number;
      projectId: string;
      id: string;
      createdAt: string;
    },
  >(
    item: T,
    expected: number,
    get: (projectId: string, id: string) => T | undefined,
  ): T {
    kernelInteger(expected);
    const before = get(item.projectId, item.id);
    if (!before || before.version !== expected || item.version !== expected + 1)
      throw new KernelFault("stale_object");
    if (item.createdAt !== before.createdAt)
      throw new KernelFault("invalid_record");
    return before;
  }
  function requireReview(projectId: string, id: string) {
    const review = reviews.getById(projectId, id);
    if (!review || KERNEL_TERMINAL_STATES.includes(review.status))
      throw new KernelFault("relation_mismatch");
    return review;
  }
  function reviewRelations(r: KernelReview) {
    const existingAttempts = db
      .all<{ attempt_id: string }>(
        "SELECT attempt_id FROM research_provider_attempts WHERE project_id=? AND review_id=? ORDER BY ordinal",
        r.projectId,
        r.id,
      )
      .map((a) => a.attempt_id);
    if (kernelHash(existingAttempts) !== kernelHash(r.attemptIds))
      throw new KernelFault("relation_mismatch");
    if (r.manifestId) {
      const m = manifests.getById(r.projectId, r.manifestId);
      if (
        m?.reviewId !== r.id ||
        m.baseProjectStateRevision !== r.baseProjectStateRevision
      )
        throw new KernelFault("relation_mismatch");
    }
    const lastId = r.attemptIds.at(-1);
    const last = lastId ? attempts.getById(r.projectId, lastId) : undefined;
    const expected = {
      provider_attempt_prepared: "prepared",
      provider_attempt_running: "running",
      provider_attempt_uncertain: "uncertain",
      provider_attempt_failed: "failed",
      assessment_recorded: "completed",
    } as const;
    if (
      r.status in expected &&
      last?.status !== expected[r.status as keyof typeof expected]
    )
      throw new KernelFault("relation_mismatch");
    if (
      r.status === "manifest_confirmed" &&
      (!r.manifestId ||
        manifests.getById(r.projectId, r.manifestId)?.status !== "confirmed")
    )
      throw new KernelFault("relation_mismatch");
  }
  const reviewRepository: KernelRepository<KernelReview> = Object.freeze({
    ...reviews,
    create(input: KernelReview) {
      const r = parseKernelReview(input);
      return write(r.projectId, () => {
        const old = initial(r, reviews.getById);
        if (old) return old;
        if (
          r.status !== "draft" ||
          r.source.kind === "legacy_receipt" ||
          r.manifestId ||
          r.attemptIds.length ||
          r.effectDraft ||
          r.terminalOutcome
        )
          throw new KernelFault("illegal_transition");
        if (
          r.baseProjectStateRevision !==
          readKernelHead(db, r.projectId).revision
        )
          throw new KernelFault("stale_revision");
        db.run(
          "INSERT INTO research_reviews(review_id,project_id,status,base_revision,version,suggestion_hash,manifest_id,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
          r.id,
          r.projectId,
          r.status,
          r.baseProjectStateRevision,
          r.version,
          r.suggestionHash,
          r.manifestId,
          r.createdAt,
          r.updatedAt,
          kernelCanonicalJson(r),
        );
        return r;
      });
    },
    compareAndSwap(input: KernelReview, expectedVersion: number) {
      const r = parseKernelReview(input);
      return write(r.projectId, () => {
        const old = next(r, expectedVersion, reviews.getById);
        if (
          KERNEL_TERMINAL_STATES.includes(old.status) ||
          (old.status !== r.status &&
            !transitions[old.status].includes(r.status))
        )
          throw new KernelFault("illegal_transition");
        if (
          ["committed", "disposed"].includes(r.status) &&
          !db.isKernelCanonicalWrite
        )
          throw new KernelFault("authority_required");
        if (
          kernelHash(old.source) !== kernelHash(r.source) ||
          (old.suggestionHash !== r.suggestionHash && old.status !== "draft")
        )
          throw new KernelFault("invalid_record");
        if (
          r.baseProjectStateRevision !== old.baseProjectStateRevision &&
          !(old.status === "stale" && r.status === "manifest_prepared")
        )
          throw new KernelFault("stale_revision");
        if (
          r.effectDraft &&
          kernelHash(r.effectDraft) !== kernelHash(old.effectDraft) &&
          r.baseProjectStateRevision !==
            readKernelHead(db, r.projectId).revision
        )
          throw new KernelFault("stale_revision");
        reviewRelations(r);
        const result = db.run(
          "UPDATE research_reviews SET status=?,base_revision=?,version=?,suggestion_hash=?,manifest_id=?,updated_at=?,data=? WHERE project_id=? AND review_id=? AND version=?",
          r.status,
          r.baseProjectStateRevision,
          r.version,
          r.suggestionHash,
          r.manifestId,
          r.updatedAt,
          kernelCanonicalJson(r),
          r.projectId,
          r.id,
          expectedVersion,
        );
        if (Number(result.changes) !== 1) throw new KernelFault("stale_object");
        return r;
      });
    },
  });
  const manifestRepository: KernelRepository<KernelManifest> = Object.freeze({
    ...manifests,
    create(input: KernelManifest) {
      const m = parseKernelManifest(input);
      return write(m.projectId, () => {
        const old = initial(m, manifests.getById);
        if (old) return old;
        requireReview(m.projectId, m.reviewId);
        if (
          m.status !== "prepared" ||
          m.baseProjectStateRevision !==
            readKernelHead(db, m.projectId).revision
        )
          throw new KernelFault("stale_revision");
        db.run(
          "INSERT INTO context_manifests(manifest_id,project_id,review_id,base_revision,status,version,identity_hash,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
          m.id,
          m.projectId,
          m.reviewId,
          m.baseProjectStateRevision,
          m.status,
          m.version,
          m.identityHash,
          m.createdAt,
          m.updatedAt,
          JSON.stringify(m),
        );
        return m;
      });
    },
    compareAndSwap(input: KernelManifest, expectedVersion: number) {
      const m = parseKernelManifest(input);
      return write(m.projectId, () => {
        const old = next(m, expectedVersion, manifests.getById);
        const allowed: Record<KernelManifest["status"], readonly string[]> = {
          prepared: ["confirmed", "stale", "cancelled"],
          confirmed: ["sent", "stale", "cancelled"],
          sent: ["stale"],
          stale: [],
          cancelled: [],
        };
        if (
          old.identityHash !== m.identityHash ||
          !allowed[old.status].includes(m.status)
        )
          throw new KernelFault("illegal_transition");
        if (
          ["confirmed", "sent"].includes(m.status) &&
          m.baseProjectStateRevision !==
            readKernelHead(db, m.projectId).revision
        )
          throw new KernelFault("stale_revision");
        db.run(
          "UPDATE context_manifests SET status=?,version=?,updated_at=?,data=? WHERE project_id=? AND manifest_id=? AND version=?",
          m.status,
          m.version,
          m.updatedAt,
          JSON.stringify(m),
          m.projectId,
          m.id,
          expectedVersion,
        );
        return m;
      });
    },
  });
  const attemptRepository: KernelRepository<KernelAttempt> = Object.freeze({
    ...attempts,
    create(input: KernelAttempt) {
      const a = parseKernelAttempt(input);
      return write(a.projectId, () => {
        const old = initial(a, attempts.getById);
        if (old) return old;
        const review = requireReview(a.projectId, a.reviewId);
        const manifest = manifests.getById(a.projectId, a.manifestId);
        const ordinal = Number(
          db.get<{ n: number }>(
            "SELECT COALESCE(MAX(ordinal),0)+1 n FROM research_provider_attempts WHERE project_id=? AND review_id=?",
            a.projectId,
            a.reviewId,
          )?.n,
        );
        if (
          a.status !== "prepared" ||
          !["manifest_confirmed", "provider_attempt_uncertain"].includes(
            review.status,
          ) ||
          !manifest?.provider ||
          manifest.status !== "confirmed" ||
          manifest.reviewId !== a.reviewId ||
          manifest.identityHash !== a.manifestIdentityHash ||
          a.ordinal !== ordinal
        )
          throw new KernelFault("relation_mismatch");
        if (
          manifest.baseProjectStateRevision !==
          readKernelHead(db, a.projectId).revision
        )
          throw new KernelFault("stale_revision");
        db.run(
          "INSERT INTO research_provider_attempts(attempt_id,project_id,review_id,ordinal,manifest_id,status,version,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
          a.id,
          a.projectId,
          a.reviewId,
          a.ordinal,
          a.manifestId,
          a.status,
          a.version,
          a.createdAt,
          a.updatedAt,
          kernelCanonicalJson(a),
        );
        return a;
      });
    },
    compareAndSwap(input: KernelAttempt, expectedVersion: number) {
      const a = parseKernelAttempt(input);
      return write(a.projectId, () => {
        const old = next(a, expectedVersion, attempts.getById);
        const allowed: Record<KernelAttempt["status"], readonly string[]> = {
          prepared: ["running", "cancelled"],
          running: ["completed", "failed", "uncertain", "cancelled"],
          completed: [],
          failed: [],
          uncertain: [],
          cancelled: [],
        };
        if (
          !allowed[old.status].includes(a.status) ||
          a.reviewId !== old.reviewId ||
          a.ordinal !== old.ordinal ||
          a.manifestId !== old.manifestId ||
          a.manifestIdentityHash !== old.manifestIdentityHash ||
          old.assessment !== null
        )
          throw new KernelFault("illegal_transition");
        if (a.status === "running") {
          const manifest = manifests.getById(a.projectId, a.manifestId);
          if (
            manifest?.status !== "confirmed" ||
            manifest.baseProjectStateRevision !==
              readKernelHead(db, a.projectId).revision
          )
            throw new KernelFault("stale_revision");
        }
        db.run(
          "UPDATE research_provider_attempts SET status=?,version=?,updated_at=?,data=? WHERE project_id=? AND attempt_id=? AND version=?",
          a.status,
          a.version,
          a.updatedAt,
          kernelCanonicalJson(a),
          a.projectId,
          a.id,
          expectedVersion,
        );
        return a;
      });
    },
  });
  return Object.freeze({
    reviews: reviewRepository,
    attempts: attemptRepository,
    manifests: manifestRepository,
    corrections: Object.freeze({
      ...corrections,
      create(input: KernelCorrection) {
        const c = parseKernelCorrection(input);
        return write(c.projectId, () => {
          const old = initial(c, corrections.getById);
          if (old) return old;
          const attempt = attempts.getById(c.projectId, c.attemptId);
          if (
            attempt?.reviewId !== c.reviewId ||
            attempt.assessmentHash !== c.originalAssessmentHash ||
            attempt.status !== "completed"
          )
            throw new KernelFault("relation_mismatch");
          db.run(
            "INSERT INTO research_review_corrections(correction_id,project_id,review_id,attempt_id,original_assessment_hash,version,created_at,data) VALUES(?,?,?,?,?,1,?,?)",
            c.id,
            c.projectId,
            c.reviewId,
            c.attemptId,
            c.originalAssessmentHash,
            c.createdAt,
            kernelCanonicalJson(c),
          );
          return c;
        });
      },
    }),
    receipts: reader(db, {
      table: "research_transition_receipts",
      id: "receipt_id",
      parse: parseKernelReceipt,
    }),
    events: reader(db, {
      table: "research_project_state_events",
      id: "event_id",
      parse: parseKernelEvent,
    }),
    heads: Object.freeze({
      get: (projectId: string) => readKernelHead(db, projectId),
    }),
  });
}
