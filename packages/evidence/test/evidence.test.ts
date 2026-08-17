import { describe, it, expect } from "vitest";
import { SestinaErrorCode, generateId } from "@sestina/schema";
import {
  EXCERPT_MAX_BYTES,
  minimizeLocatorPath,
  truncateUtf8Bytes,
} from "../src/evidence-service.js";
import { AGENT, HASH_A, HASH_B, PEER_HOOK, PEER_MCP, USER, expectSestinaCode, makeHarness } from "./harness.js";

// ── EvidenceService rules (docs/22 Task 10, B4) ──

describe("EvidenceService (docs/22 Task 10)", () => {
  it("rejects a task owned by another project when recording evidence", () => {
    const h = makeHarness();
    expectSestinaCode(
      () => {
        h.evidence.record(h.projectId, {
          taskId: h.otherTaskId,
          type: "primary_source",
          locator: { type: "path", value: "foreign-task.txt" },
          provenance: AGENT,
        });
      },
      SestinaErrorCode.task_not_found,
    );
  });

  it("validates the task fence and derives the project from the task", () => {
    const h = makeHarness();
    expectSestinaCode(
      () => {
        h.evidence.record(h.projectId, {
          taskId: generateId(),
          type: "primary_source",
          locator: { type: "path", value: "a.txt" },
          provenance: AGENT,
        });
      },
      SestinaErrorCode.task_not_found,
    );
    const item = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "a.txt" },
      provenance: AGENT,
    });
    expect(h.evidence.get(h.projectId, item.evidenceId)?.evidenceId).toBe(item.evidenceId);
    expect(h.evidence.get(h.otherProjectId, item.evidenceId)).toBeUndefined();
  });

  it("keeps canonical local paths distinct and minimises them only for export", () => {
    const h = makeHarness();
    const absolute = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "C:\\synthetic\\alpha\\report.txt" },
      provenance: AGENT,
    });
    const sameBasename = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "C:\\synthetic\\beta\\report.txt" },
      provenance: AGENT,
    });
    expect(absolute.locator.value).toBe("C:\\synthetic\\alpha\\report.txt");
    expect(sameBasename.locator.value).toBe("C:\\synthetic\\beta\\report.txt");
    expect(absolute.locator.value).not.toBe(sameBasename.locator.value);
    const relative = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "synthetic/relative/report.txt" },
      provenance: AGENT,
    });
    expect(relative.locator.value).toBe("synthetic/relative/report.txt");
    expect(minimizeLocatorPath("/home/someone/secret.md")).toBe("secret.md");
    expect(minimizeLocatorPath("\\\\server\\share\\file.txt")).toBe("file.txt");
    expect(minimizeLocatorPath("already/relative.txt")).toBe("already/relative.txt");
  });

  it("redacts excerpts through the injected port and enforces byte AND char limits", () => {
    // Redaction port doubles as an observable: it must actually be called.
    let redacted: string | undefined;
    const harness = makeHarness({
      now: () => "2026-08-01T00:00:00.000Z",
      nowMs: () => Date.parse("2026-08-01T00:00:00.000Z"),
      newId: () => "ev-redacted",
      redactExcerpt: (excerpt: string) => {
        redacted = excerpt;
        return "[redacted]";
      },
    });
    const item = harness.evidence.record(harness.projectId, {
      taskId: harness.taskId,
      type: "primary_source",
      locator: { type: "path", value: "synthetic.txt" },
      excerpt: "sensitive-synthetic-excerpt",
      provenance: AGENT,
    });
    expect(redacted).toBe("sensitive-synthetic-excerpt");
    expect(item.excerpt).toBe("[redacted]");

    // Byte limit: a 4-byte-per-character string longer than the cap.
    const longExcerpt = "𝄞".repeat(Math.floor(EXCERPT_MAX_BYTES / 4) + 10);
    const truncated = harness.evidence.record(harness.projectId, {
      taskId: harness.taskId,
      type: "primary_source",
      locator: { type: "path", value: "synthetic.txt" },
      excerpt: longExcerpt,
      provenance: AGENT,
    });
    expect(new TextEncoder().encode(truncated.excerpt ?? "").length).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    expect(truncated.excerpt?.endsWith("\uFFFD")).toBe(false);
  });

  it("truncateUtf8Bytes never splits a code point", () => {
    expect(truncateUtf8Bytes("abc", 2)).toBe("ab");
    expect(truncateUtf8Bytes("a𝄞c", 2)).toBe("a");
    expect(truncateUtf8Bytes("a𝄞c", 5)).toBe("a𝄞");
    expect(truncateUtf8Bytes("日本語", 6)).toBe("日本");
  });

  it("rejects a duplicate content hash within one task and scopes dedup per project/task", () => {
    const h = makeHarness();
    h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "a.txt" },
      contentHash: HASH_A,
      provenance: AGENT,
    });
    expectSestinaCode(
      () => {
        h.evidence.record(h.projectId, {
          taskId: h.taskId,
          type: "primary_source",
          locator: { type: "path", value: "a-dup.txt" },
          contentHash: HASH_A,
          provenance: AGENT,
        });
      },
      SestinaErrorCode.idempotency_violation,
    );
    // Different task, same project: allowed.
    const taskSameHash = generateId();
    h.world.tasks.set(taskSameHash, h.projectId);
    const second = h.evidence.record(h.projectId, {
      taskId: taskSameHash,
      type: "primary_source",
      locator: { type: "path", value: "b.txt" },
      contentHash: HASH_A,
      provenance: AGENT,
    });
    expect(second.status).toBe("unverified");
    const third = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "c.txt" },
      contentHash: HASH_B,
      provenance: AGENT,
    });
    h.evidence.supersede(h.projectId, third.evidenceId, third.version, AGENT, "synthetic reason");
    // A superseded item can never be verified afterwards.
    expectSestinaCode(
      () => {
        h.evidence.verify(h.projectId, third.evidenceId, third.version + 1, USER);
      },
      SestinaErrorCode.validation_failed,
    );
    h.evidence.dispute(h.projectId, second.evidenceId, second.version, USER, "synthetic dispute");
    // History recorded the transitions append-only.
    expect(h.stores.evidence.history(h.projectId, second.evidenceId).map((r) => r.toStatus))
      .toEqual(["disputed"]);
  });

  it("demotes peer-recorded evidence to the unverified reported ceiling", () => {
    const h = makeHarness();
    const peerEvidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "peer.txt" },
      provenance: PEER_MCP,
    });
    expect(peerEvidence.status).toBe("unverified");
    expect(peerEvidence.recordedBy).toBe("agent");
    const hookEvidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "hook.txt" },
      provenance: PEER_HOOK,
    });
    expect(hookEvidence.status).toBe("unverified");
    expect(hookEvidence.recordedBy).toBe("hook");
    // A peer CANNOT self-verify its own content into a higher status by
    // recording it as a user would: recordedBy for user provenance is "user".
    const userEvidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "user.txt" },
      provenance: USER,
    });
    expect(userEvidence.recordedBy).toBe("user");
  });

  it("does not let peer provenance verify evidence", () => {
    const h = makeHarness();
    const peerEvidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "peer.txt" },
      provenance: PEER_MCP,
    });
    expectSestinaCode(
      () => {
        h.evidence.verify(h.projectId, peerEvidence.evidenceId, peerEvidence.version, PEER_MCP);
      },
      SestinaErrorCode.forbidden,
    );
    expect(h.evidence.get(h.projectId, peerEvidence.evidenceId)?.status).toBe("unverified");
  });

  it("requires the caller's expected version for every status transition", () => {
    const h = makeHarness();
    const item = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "test_result",
      locator: { type: "artifact", value: "synthetic-test" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, item.evidenceId, 1, USER);
    expectSestinaCode(
      () => {
        h.evidence.dispute(h.projectId, item.evidenceId, 1, USER, "stale caller");
      },
      SestinaErrorCode.stale_state,
    );
    expect(h.evidence.get(h.projectId, item.evidenceId)?.status).toBe("verified");
  });
});
