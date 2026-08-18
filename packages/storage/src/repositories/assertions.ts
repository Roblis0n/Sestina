import {
  ActorProvenanceSchema,
  ConfirmationSourceSchema,
  SituationAssertionSchema,
  SestinaError,
  SestinaErrorCode,
  canActAsDirectUser,
  type ActorProvenance,
  type ConfirmationSource,
  type SituationAssertion,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  assertInTransaction,
  deriveLedgerHistory,
  fromMs,
  insertLedgerHistory,
  keysetPage,
  parseLedgerActor,
  readLedgerHistory,
  toMs,
  type CursorInput,
  type LedgerHistoryRead,
  type LedgerHistoryWrite,
  type Page,
} from "./shared.js";

export interface AssertionRepository {
  /**
   * Insert-only with a task-in-project fence (docs/22 Task 10): when the
   * assertion carries a taskId, that task must exist in the assertion's
   * project - a missing task and a cross-project task fail with the same
   * stable task_not_found error, so no cross-project existence leaks.
   */
  insert(assertion: SituationAssertion): void;
  get(projectId: string, assertionId: string): SituationAssertion | undefined;
  listByProject(projectId: string, input: CursorInput): Page<SituationAssertion>;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<SituationAssertion>;
  /** Rows whose superseded_by points at this assertion (supersession chain). */
  listSuperseders(projectId: string, assertionId: string): SituationAssertion[];
  /**
   * Authority-bound promotion. Unlike transition(), this method constructs
   * confirmed_fact internally after re-reading the persisted authority
   * source in the same transaction.
   */
  confirm(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    confirmation: ConfirmationSource,
    caller: ActorProvenance,
    history: LedgerHistoryWrite,
  ): SituationAssertion;
  /**
   * CAS status transition: applies `next` only when the stored row is at
   * `expectedVersion`, bumps the version and appends one history row.
   * Append-only: the old state survives in assertion_history.
   */
  transition(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    next: SituationAssertion,
    history: LedgerHistoryWrite,
  ): void;
  history(projectId: string, assertionId: string): LedgerHistoryRead[];
}

interface AssertionRow {
  assertion_id: string;
  project_id: string;
  task_id: string | null;
  status: string;
  valid_from: number | null;
  valid_until: number | null;
  kind: string;
  superseded_by: string | null;
  version: number;
  data: string;
}

function assembleAssertion(row: AssertionRow): SituationAssertion {
  const data = JSON.parse(row.data) as SituationAssertion;
  return SituationAssertionSchema.parse({
    ...data,
    assertionId: row.assertion_id,
    projectId: row.project_id,
    taskId: row.task_id ?? undefined,
    status: row.status,
    validFrom: row.valid_from !== null ? fromMs(row.valid_from) : data.validFrom,
    validUntil: row.valid_until !== null ? fromMs(row.valid_until) : data.validUntil,
    kind: row.kind as SituationAssertion["kind"],
    supersededBy: row.superseded_by ?? undefined,
    version: row.version,
  });
}

const ASSERTION_COLUMNS = `assertion_id, project_id, task_id, status, valid_from, valid_until, kind, superseded_by, version, data`;
const SYSTEM_ACTOR: ActorProvenance = {
  actor: "system",
  channel: "runtime",
  directUser: false,
};
const HOOK_OBSERVATION_EVENT_TYPES = new Set([
  "session_start",
  "user_prompt",
  "pre_tool",
  "permission_request",
  "post_tool",
  "tool_failure",
  "pre_compact",
  "post_compact",
  "stop",
  "session_end",
]);

const ASSERTION_STATUS_TRANSITIONS: Readonly<
  Record<SituationAssertion["status"], readonly SituationAssertion["status"][]>
> = {
  active: ["disputed", "expired", "superseded"],
  disputed: ["disputed", "expired", "superseded"],
  expired: ["superseded"],
  superseded: [],
};

function sameProvenance(left: ActorProvenance, right: ActorProvenance): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function immutableAssertionPayload(assertion: SituationAssertion): unknown {
  return {
    assertionId: assertion.assertionId,
    projectId: assertion.projectId,
    taskId: assertion.taskId,
    kind: assertion.kind,
    statement: assertion.statement,
    sourceRefs: assertion.sourceRefs,
    confidence: assertion.confidence,
    limitations: assertion.limitations,
    missingReason: assertion.missingReason,
    confirmations: assertion.confirmations,
    provenance: assertion.provenance,
    createdAt: assertion.createdAt,
    validFrom: assertion.validFrom,
  };
}

function assertLegalAssertionTransition(
  current: SituationAssertion,
  next: SituationAssertion,
): void {
  if (
    JSON.stringify(immutableAssertionPayload(current)) !==
    JSON.stringify(immutableAssertionPayload(next))
  ) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "A generic assertion transition cannot rewrite assertion content or authority",
    );
  }
  if (!ASSERTION_STATUS_TRANSITIONS[current.status].includes(next.status)) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `Illegal assertion status transition: ${current.status} -> ${next.status}`,
    );
  }
  if (next.status === "expired") {
    if (next.validUntil === undefined) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "An expired assertion requires validUntil",
      );
    }
  } else if (next.validUntil !== current.validUntil) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "validUntil can change only while expiring an assertion",
    );
  }
  if (next.status === "superseded") {
    if (next.supersededBy === undefined) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "A superseded assertion requires supersededBy",
      );
    }
  } else if (next.supersededBy !== current.supersededBy) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "supersededBy can change only while superseding an assertion",
    );
  }
}

export function createAssertionRepository(tx: StorageTransaction): AssertionRepository {
  return {
    insert(assertion) {
      assertInTransaction(tx);
      if (assertion.version !== 1) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "A new assertion must start at version 1",
        );
      }
      if (assertion.kind === "confirmed_fact") {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "A confirmed fact must be created through authority-bound confirmation",
        );
      }
      if (assertion.taskId !== undefined) {
        const task = tx.get<{ project_id: string }>(
          "SELECT project_id FROM tasks WHERE task_id = ?",
          assertion.taskId,
        );
        if (task?.project_id !== assertion.projectId) {
          throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
        }
      }
      tx.run(
        `INSERT INTO situation_assertions
           (assertion_id, project_id, task_id, status, valid_from, valid_until, kind,
            superseded_by, version, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        assertion.assertionId,
        assertion.projectId,
        assertion.taskId ?? null,
        assertion.status,
        toMs(assertion.validFrom),
        assertion.validUntil ? toMs(assertion.validUntil) : null,
        assertion.kind,
        assertion.supersededBy ?? null,
        assertion.version,
        validateJson(SituationAssertionSchema, assertion, "SituationAssertion"),
      );
    },

    get(projectId, assertionId) {
      const row = tx.get<AssertionRow>(
        `SELECT ${ASSERTION_COLUMNS} FROM situation_assertions WHERE assertion_id = ? AND project_id = ?`,
        assertionId,
        projectId,
      );
      return row ? assembleAssertion(row) : undefined;
    },

    listByProject(projectId, input) {
      const page = keysetPage<AssertionRow>(tx, {
        table: "situation_assertions",
        columns: ASSERTION_COLUMNS,
        keyColumn: "valid_from",
        idColumn: "assertion_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map(assembleAssertion), nextCursor: page.nextCursor };
    },

    listByTask(projectId, taskId, input) {
      const page = keysetPage<AssertionRow>(tx, {
        table: "situation_assertions",
        columns: ASSERTION_COLUMNS,
        keyColumn: "valid_from",
        idColumn: "assertion_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "task_id = ?",
        extraParams: [taskId],
      });
      return { items: page.items.map(assembleAssertion), nextCursor: page.nextCursor };
    },

    listSuperseders(projectId, assertionId) {
      const rows = tx.all<AssertionRow>(
        `SELECT ${ASSERTION_COLUMNS} FROM situation_assertions
         WHERE project_id = ? AND superseded_by = ?
         ORDER BY version, assertion_id`,
        projectId,
        assertionId,
      );
      return rows.map(assembleAssertion);
    },

    confirm(projectId, assertionId, expectedVersion, confirmation, caller, history) {
      assertInTransaction(tx);
      const parsedConfirmation = ConfirmationSourceSchema.safeParse(confirmation);
      const parsedCaller = ActorProvenanceSchema.safeParse(caller);
      if (!parsedConfirmation.success || !parsedCaller.success) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Confirmation source or caller provenance is invalid",
        );
      }
      const row = tx.get<AssertionRow>(
        `SELECT ${ASSERTION_COLUMNS} FROM situation_assertions
         WHERE assertion_id = ? AND project_id = ?`,
        assertionId,
        projectId,
      );
      if (!row) {
        throw new SestinaError(SestinaErrorCode.assertion_not_found, "Assertion not found");
      }
      if (row.version !== expectedVersion) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Assertion was modified concurrently; reload and retry",
        );
      }
      const current = assembleAssertion(row);
      if (current.status !== "active" || current.kind === "confirmed_fact") {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Only an active, unconfirmed assertion can be confirmed",
        );
      }
      const ledgerHistory = deriveLedgerHistory(
        history,
        expectedVersion,
        current.status,
        current.status,
        "confirm",
      );
      const historyActor = parseLedgerActor(ledgerHistory);

      let resolved: ConfirmationSource | undefined;
      switch (parsedConfirmation.data.sourceType) {
        case "verified_evidence": {
          const evidence = tx.get<{
            task_id: string | null;
            status: string;
            content_hash: string;
            expires_at: number | null;
          }>(
            `SELECT task_id, status, content_hash, expires_at
             FROM evidence_items
             WHERE evidence_id = ? AND project_id = ?`,
            parsedConfirmation.data.evidenceId,
            projectId,
          );
          if (
            evidence !== undefined &&
            evidence.task_id !== null &&
            (current.taskId === undefined || evidence.task_id === current.taskId) &&
            evidence.status === "verified" &&
            evidence.content_hash === parsedConfirmation.data.contentHash &&
            (evidence.expires_at === null || evidence.expires_at > Date.now())
          ) {
            resolved = {
              sourceType: "verified_evidence",
              evidenceId: parsedConfirmation.data.evidenceId,
              contentHash: evidence.content_hash,
            };
          }
          break;
        }
        case "tool_result":
        case "hook_observation": {
          const event = tx.get<{ task_id: string; event_type: string; data: string }>(
            `SELECT task_id, event_type, data FROM events
             WHERE event_id = ? AND project_id = ?`,
            parsedConfirmation.data.refId,
            projectId,
          );
          let sourceCapability: unknown;
          if (event !== undefined) {
            try {
              sourceCapability = (JSON.parse(event.data) as Record<string, unknown>).sourceCapability;
            } catch {
              sourceCapability = undefined;
            }
          }
          const eventTypeAllowed =
            parsedConfirmation.data.sourceType === "tool_result"
              ? event?.event_type === "post_tool"
              : event !== undefined && HOOK_OBSERVATION_EVENT_TYPES.has(event.event_type);
          if (
            event !== undefined &&
            eventTypeAllowed &&
            sourceCapability === "hooks" &&
            (current.taskId === undefined || event.task_id === current.taskId)
          ) {
            resolved = {
              sourceType: parsedConfirmation.data.sourceType,
              refId: parsedConfirmation.data.refId,
              trusted: true,
            };
          }
          break;
        }
        case "direct_user":
          if (
            canActAsDirectUser(parsedCaller.data) &&
            sameProvenance(parsedCaller.data, parsedConfirmation.data.provenance)
          ) {
            resolved = {
              sourceType: "direct_user",
              provenance: parsedCaller.data,
            };
          }
          break;
        case "judge_opinion":
          break;
      }
      if (!resolved) {
        throw new SestinaError(
          SestinaErrorCode.insufficient_confirmation_source,
          "The persisted confirmation source cannot confirm this assertion",
        );
      }
      const expectedActor =
        resolved.sourceType === "direct_user" ? parsedCaller.data : SYSTEM_ACTOR;
      if (!sameProvenance(historyActor, expectedActor)) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Confirmation history actor does not match the authoritative source",
        );
      }
      const parsedNext = SituationAssertionSchema.safeParse({
        ...current,
        kind: "confirmed_fact",
        confirmations: [...(current.confirmations ?? []), resolved],
        version: expectedVersion + 1,
      });
      if (!parsedNext.success) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Confirmed assertion failed schema validation",
        );
      }
      const result = tx.run(
        `UPDATE situation_assertions SET kind = ?, version = ?, data = ?
         WHERE assertion_id = ? AND project_id = ? AND version = ?`,
        parsedNext.data.kind,
        parsedNext.data.version,
        validateJson(SituationAssertionSchema, parsedNext.data, "SituationAssertion"),
        assertionId,
        projectId,
        expectedVersion,
      );
      if (Number(result.changes) !== 1) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Assertion changed concurrently; reload and retry",
        );
      }
      insertLedgerHistory(
        tx,
        "assertion_history",
        "assertion_id",
        projectId,
        assertionId,
        ledgerHistory,
      );
      return parsedNext.data;
    },

    transition(projectId, assertionId, expectedVersion, next, history) {
      assertInTransaction(tx);
      if (next.assertionId !== assertionId) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Transition target id must match the assertion id",
        );
      }
      if (next.projectId !== projectId) {
        throw new SestinaError(
          SestinaErrorCode.project_isolation_violation,
          "Assertion belongs to a different project",
        );
      }
      if (next.version !== expectedVersion + 1) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "next.version must be expectedVersion + 1",
        );
      }
      const parsedNext = SituationAssertionSchema.safeParse(next);
      if (!parsedNext.success) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "The assertion transition payload is invalid",
        );
      }
      const existing = tx.get<AssertionRow>(
        `SELECT ${ASSERTION_COLUMNS} FROM situation_assertions
         WHERE assertion_id = ? AND project_id = ?`,
        assertionId,
        projectId,
      );
      if (!existing) {
        throw new SestinaError(SestinaErrorCode.assertion_not_found, "Assertion not found");
      }
      if (existing.version !== expectedVersion) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Assertion was modified concurrently; reload and retry",
        );
      }
      const current = assembleAssertion(existing);
      assertLegalAssertionTransition(current, parsedNext.data);
      const storedNext = SituationAssertionSchema.parse({
        ...current,
        status: parsedNext.data.status,
        validUntil: parsedNext.data.validUntil,
        supersededBy: parsedNext.data.supersededBy,
        version: expectedVersion + 1,
      });
      const ledgerHistory = deriveLedgerHistory(
        history,
        expectedVersion,
        current.status,
        storedNext.status,
        "transition",
      );
      const result = tx.run(
        `UPDATE situation_assertions SET
           status = ?, valid_from = ?, valid_until = ?, kind = ?, superseded_by = ?,
           version = ?, data = ?
         WHERE assertion_id = ? AND project_id = ? AND version = ?`,
        storedNext.status,
        toMs(storedNext.validFrom),
        storedNext.validUntil ? toMs(storedNext.validUntil) : null,
        storedNext.kind,
        storedNext.supersededBy ?? null,
        storedNext.version,
        validateJson(SituationAssertionSchema, storedNext, "SituationAssertion"),
        assertionId,
        projectId,
        expectedVersion,
      );
      if (Number(result.changes) !== 1) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Assertion changed concurrently; reload and retry",
        );
      }
      insertLedgerHistory(
        tx,
        "assertion_history",
        "assertion_id",
        projectId,
        assertionId,
        ledgerHistory,
      );
    },

    history(projectId, assertionId) {
      return readLedgerHistory(tx, "assertion_history", "assertion_id", projectId, assertionId);
    },
  };
}
