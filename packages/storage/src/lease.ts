import { randomUUID } from "node:crypto";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageTransaction } from "./transaction.js";

/**
 * Lease claims are read-check-then-write units: they must run inside a
 * transaction (BEGIN IMMEDIATE serialises writers), otherwise two callers
 * can observe "no row" and both acquire.
 */
function assertInTransaction(tx: StorageTransaction): void {
  if (!tx.database.isTransaction) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "Lease claim must run inside a transaction",
    );
  }
}

/**
 * Validates a lease TTL: must be a positive safe integer that cannot push
 * `now + ttlMs` beyond Number.MAX_SAFE_INTEGER (which would poison the row
 * so it can never be read back or compared).
 */
export function validateLeaseTtlMs(ttlMs: number | undefined, label: string): number {
  const value = ttlMs ?? DEFAULT_EVENT_LEASE_TTL_MS;
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > Number.MAX_SAFE_INTEGER - Date.now()
  ) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `${label} must be a positive safe integer`,
    );
  }
  return value;
}

// ── Event leases (docs/22 Task 5 Step 4) ──

export interface EventLease {
  idempotencyKey: string;
  ownerId: string;
  /** Per-acquisition fencing token (migration 005). */
  token: string;
  expiresAt: number; // integer milliseconds since epoch
  packetHash?: string;
}

export interface EventLeaseInput {
  idempotencyKey: string;
  ownerId: string;
  /** Required: retries with a different payload are rejected. */
  packetHash: string;
  ttlMs?: number;
}

export type ClaimEventLeaseKind = "acquired" | "wait_for_existing" | "already_completed";

export interface EventLeaseClaim {
  kind: ClaimEventLeaseKind;
  /** Present when kind === "acquired". */
  token?: string;
}

export const DEFAULT_EVENT_LEASE_TTL_MS = 30_000;

interface LeaseRow {
  owner_id: string;
  expires_at: number;
  completed_at: number | null;
  packet_hash: string | null;
}

/**
 * Claims the processing lease for an event idempotency key. Exactly one
 * owner can hold an unexpired lease at a time; completed keys can never be
 * claimed again (docs/08 §15, docs/19 §10). Every acquisition carries a new
 * fencing token, and retries with a DIFFERENT payload hash are rejected
 * with idempotency_violation (same key must mean the same payload).
 */
export function claimEventLease(
  tx: StorageTransaction,
  input: EventLeaseInput,
): EventLeaseClaim {
  assertInTransaction(tx);
  const ttlMs = validateLeaseTtlMs(input.ttlMs, "Event lease ttlMs");
  const now = Date.now();
  const row = tx.get<LeaseRow>(
    "SELECT owner_id, expires_at, completed_at, packet_hash FROM event_leases WHERE idempotency_key = ?",
    input.idempotencyKey,
  );
  if (row) {
    if (row.completed_at !== null) return { kind: "already_completed" };
    if (row.packet_hash !== null && row.packet_hash !== input.packetHash) {
      throw new SestinaError(
        SestinaErrorCode.idempotency_violation,
        "Idempotency key reused with a different payload",
      );
    }
    if (row.expires_at > now && row.owner_id !== input.ownerId) {
      return { kind: "wait_for_existing" };
    }
  }
  const token = randomUUID();
  tx.run(
    `INSERT INTO event_leases (idempotency_key, owner_id, expires_at, packet_hash, fence_token)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       owner_id = excluded.owner_id,
       expires_at = excluded.expires_at,
       packet_hash = excluded.packet_hash,
       fence_token = excluded.fence_token`,
    input.idempotencyKey,
    input.ownerId,
    now + ttlMs,
    input.packetHash,
    token,
  );
  return { kind: "acquired", token };
}

/**
 * Marks an event lease as completed; further claims return already_completed.
 * The completion must carry the current fencing token AND an unexpired lease
 * — an expired lease can never complete (docs/19 §10).
 */
export function completeEventLease(
  tx: StorageTransaction,
  input: { idempotencyKey: string; ownerId: string; token: string },
): void {
  assertInTransaction(tx);
  const result = tx.run(
    `UPDATE event_leases SET completed_at = ?
     WHERE idempotency_key = ? AND owner_id = ? AND fence_token = ? AND expires_at > ?`,
    Date.now(),
    input.idempotencyKey,
    input.ownerId,
    input.token,
    Date.now(),
  );
  if (Number(result.changes) === 0) {
    throw new SestinaError(
      SestinaErrorCode.stale_state,
      "Event lease is not held by the given owner or is expired",
    );
  }
}

// ── Collaboration delivery leases (docs/22 Task 5 Step 4) ──

export interface MessageDeliveryLeaseInput {
  messageId: string;
  targetEndpointId: string;
  ownerId: string;
  ttlMs?: number;
}

export type ClaimMessageDeliveryLeaseKind =
  | "acquired"
  | "wait_for_existing"
  | "already_delivered";

export interface MessageDeliveryLeaseClaim {
  kind: ClaimMessageDeliveryLeaseKind;
  /** Present when kind === "acquired" — the append credential. */
  token?: string;
}

export interface DeliveryCredential {
  ownerId: string;
  token: string;
}

export const DEFAULT_DELIVERY_LEASE_TTL_MS = 30_000;

/**
 * Claims the short delivery lease for a message+target pair. The pair
 * (messageId, targetEndpointId) is the documented idempotency key
 * (docs/42 §12); only one active deliverer can own it at a time.
 */
export function claimMessageDeliveryLease(
  tx: StorageTransaction,
  input: MessageDeliveryLeaseInput,
): MessageDeliveryLeaseClaim {
  assertInTransaction(tx);
  const ttlMs = validateLeaseTtlMs(input.ttlMs, "Delivery lease ttlMs");
  const delivered = tx.get<{ attempt_id: string }>(
    "SELECT attempt_id FROM collaboration_delivery_attempts WHERE message_id = ? AND target_endpoint_id = ? AND status = 'delivered' LIMIT 1",
    input.messageId,
    input.targetEndpointId,
  );
  if (delivered) return { kind: "already_delivered" };

  const now = Date.now();
  const row = tx.get<{ lease_owner_id: string; lease_expires_at: number }>(
    "SELECT lease_owner_id, lease_expires_at FROM collaboration_delivery_leases WHERE message_id = ? AND target_endpoint_id = ?",
    input.messageId,
    input.targetEndpointId,
  );
  if (row && row.lease_expires_at > now && row.lease_owner_id !== input.ownerId) {
    return { kind: "wait_for_existing" };
  }

  const token = randomUUID();
  tx.run(
    `INSERT INTO collaboration_delivery_leases
       (message_id, target_endpoint_id, lease_owner_id, lease_expires_at, lease_token)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(message_id, target_endpoint_id) DO UPDATE SET
       lease_owner_id = excluded.lease_owner_id,
       lease_expires_at = excluded.lease_expires_at,
       lease_token = excluded.lease_token`,
    input.messageId,
    input.targetEndpointId,
    input.ownerId,
    now + ttlMs,
    token,
  );
  return { kind: "acquired", token };
}

/**
 * Releases a delivery lease. The owner check in the WHERE clause means a
 * caller can never remove another owner's lease (docs/42 §12: one active
 * deliverer per message+target). Idempotent.
 */
export function releaseMessageDeliveryLease(
  tx: StorageTransaction,
  input: { messageId: string; targetEndpointId: string; ownerId: string },
): void {
  assertInTransaction(tx);
  tx.run(
    "DELETE FROM collaboration_delivery_leases WHERE message_id = ? AND target_endpoint_id = ? AND lease_owner_id = ?",
    input.messageId,
    input.targetEndpointId,
    input.ownerId,
  );
}

/**
 * Verifies a delivery credential against the live lease row. Attempts may
 * only be appended by the current unexpired lease holder (docs/42 §12).
 */
export function assertDeliveryCredential(
  tx: StorageTransaction,
  input: { messageId: string; targetEndpointId: string; credential: DeliveryCredential },
): void {
  assertInTransaction(tx);
  const row = tx.get<{ lease_expires_at: number }>(
    `SELECT lease_expires_at FROM collaboration_delivery_leases
     WHERE message_id = ? AND target_endpoint_id = ? AND lease_owner_id = ? AND lease_token = ?`,
    input.messageId,
    input.targetEndpointId,
    input.credential.ownerId,
    input.credential.token,
  );
  if (!row || row.lease_expires_at <= Date.now()) {
    throw new SestinaError(
      SestinaErrorCode.stale_state,
      "Delivery lease credential is not valid or is expired",
    );
  }
}
