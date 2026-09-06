import { it, expect } from "vitest";
import {
  parseKernelObjectRef,
  parseKernelReceipt,
  parseKernelEvent,
  receiptHash,
  type KernelReceipt,
  type KernelEvent,
} from "@sestina/research";
import { ids, at } from "../kernel-fixtures.js";
it.each([
  { kind: "decision", id: "not-a-canonical-id", version: 1 },
  { kind: "unknown_kind", id: ids.create("rdec_"), version: 1 },
  { kind: "evidence", id: ids.create("rdec_"), version: 1 },
  {
    kind: "claim_evidence_link",
    id: `${ids.create("rclm_")}:${ids.create("rdec_")}`,
    version: 1,
  },
])(
  "G3: corrupt canonical reference $kind / $id is rejected at decode",
  (input) => {
    expect(() => parseKernelObjectRef(input)).toThrow();
  },
);
it("G3: a result Receipt cannot claim an object at the pre-creation version zero", () => {
  const body: Omit<KernelReceipt, "receiptHash"> = {
    schemaVersion: "2.0.0",
    id: ids.create("rrcp_"),
    projectId: ids.create("rprj_"),
    reviewId: ids.create("rrvw_"),
    authorityCommandId: "synthetic-command",
    effectId: "synthetic-effect",
    effectKind: "create_decision",
    previewHash: "1".repeat(64),
    actorId: "synthetic-owner",
    publicReason: "Synthetic proof must reference a saved object.",
    beforeProjectStateRevision: 1,
    afterProjectStateRevision: 2,
    revisionEventId: ids.create("rpev_"),
    resultingObjects: [
      { kind: "decision", id: ids.create("rdec_"), version: 0 },
    ],
    assessmentAvailability: "not_requested",
    manifestId: null,
    manifestIdentityHash: null,
    assessmentAttemptId: null,
    createdAt: at,
  };
  expect(() =>
    parseKernelReceipt({ ...body, receiptHash: receiptHash(body) }),
  ).toThrow();
});
it("G3: an immutable revision Trace cannot record version zero as a saved result", () => {
  const event: KernelEvent = {
    schemaVersion: "2.0.0",
    id: ids.create("rpev_"),
    projectId: ids.create("rprj_"),
    reviewId: ids.create("rrvw_"),
    revision: 2,
    transactionId: "synthetic-command",
    effectKind: "create_decision",
    changedObjectRefs: [
      { kind: "decision", id: ids.create("rdec_"), version: 0 },
    ],
    previousCanonicalHash: "0".repeat(64),
    nextCanonicalHash: "1".repeat(64),
    publicSummary: "Synthetic object was claimed saved.",
    createdAt: at,
    compensatesReceiptId: null,
  };
  expect(() => parseKernelEvent(event)).toThrow();
});
