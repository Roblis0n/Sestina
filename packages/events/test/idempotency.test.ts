import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type IdempotencyKeyInput,
  buildActionFingerprint,
  buildIdempotencyKey,
  deriveDeterministicId,
  normalizeHostEvent,
  type ActionDescriptor,
  type NormalizeHostEventInput,
  type Result,
} from "../src/index.js";

const CODEX = resolve(import.meta.dirname, "../../../tests/fixtures/hooks/codex");

function codexFixture(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(CODEX, name), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`fixture ${name} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function codexInput(
  name: string,
  extra: Partial<NormalizeHostEventInput> = {},
): NormalizeHostEventInput {
  return { host: "codex", raw: codexFixture(name), ...extra };
}

function expectOk<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

/**
 * Idempotency key spec.
 *
 * Key components (host + session + tool call id + action fingerprint
 * (+ turn where available), with a canonical phase token):
 * - Tool events:  host, sessionId, phase (pre|permission|post|failure|batch),
 *                 toolCallId ("-" when absent — Codex/Claude PermissionRequest
 *                 carry none), turn only when toolCallId is absent,
 *                 action fingerprint (toolName|category|resourceRefs).
 *   The phase token keeps PreToolUse and PostToolUse of the SAME tool call
 *   distinct while letting a hook event and the matching stream item collide
 *   deterministically (item.started=pre, item.completed=post/failure).
 * - Lifecycle/stream events: host, sessionId, native event name, turn,
 *                 discriminator (source/reason/trigger/agent_id/...).
 *
 * Same logical event twice → same key; different logical events → different
 * keys; Codex and Claude events never share keys (host differs) — the dual-
 * host guarantee is action SEMANTICS equality, never key equality.
 */
describe("idempotency keys", () => {
  it("is deterministic: normalizing the same payload twice yields the same key and ids", async () => {
    const first = expectOk(await normalizeHostEvent(codexInput("pre-tool-use-bash.json")));
    const second = expectOk(await normalizeHostEvent(codexInput("pre-tool-use-bash.json")));
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.projectId).toBe(second.projectId);
    expect(first.taskId).toBe(second.taskId);
  });

  it("formats keys as evt_ + base64url and respects the schema length bounds", async () => {
    const event = expectOk(await normalizeHostEvent(codexInput("pre-tool-use-bash.json")));
    expect(event.idempotencyKey).toMatch(/^evt_[A-Za-z0-9_-]{40,}$/);
    expect(event.idempotencyKey.length).toBeLessThanOrEqual(128);
  });

  it("gives different keys for different tool call ids", async () => {
    const a = expectOk(await normalizeHostEvent(codexInput("pre-tool-use-bash.json")));
    const b = expectOk(
      await normalizeHostEvent(
        codexInput("pre-tool-use-bash.json", {
          raw: {
            ...codexFixture("pre-tool-use-bash.json"),
            tool_use_id: "toolu_codex_01other",
          },
        }),
      ),
    );
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it("keeps pre and post phases of the same tool call distinct (no over-merge)", async () => {
    const pre = expectOk(await normalizeHostEvent(codexInput("pre-tool-use-bash.json")));
    const post = expectOk(await normalizeHostEvent(codexInput("post-tool-use-bash.json")));
    expect(pre.idempotencyKey).not.toBe(post.idempotencyKey);
  });

  it("ignores turn ids for tool events that carry a tool call id", async () => {
    const base = expectOk(await normalizeHostEvent(codexInput("pre-tool-use-bash.json")));
    const otherTurn = expectOk(
      await normalizeHostEvent(
        codexInput("pre-tool-use-bash.json", {
          raw: {
            ...codexFixture("pre-tool-use-bash.json"),
            turn_id: "turn-codex-9999",
          },
        }),
      ),
    );
    expect(base.idempotencyKey).toBe(otherTurn.idempotencyKey);
  });

  it("unifies hook and host-stream views of the same Codex tool call", async () => {
    const hook = expectOk(await normalizeHostEvent(codexInput("post-tool-use-bash.json")));
    const stream = expectOk(
      await normalizeHostEvent(
        codexInput("exec-stream-command-completed.json", {
          sessionId: "codex-sess-0001",
        }),
      ),
    );
    expect(hook.idempotencyKey).toBe(stream.idempotencyKey);
  });

  it("separates hook and stream views when the stream reports failure", async () => {
    const hookOk = expectOk(await normalizeHostEvent(codexInput("post-tool-use-bash.json")));
    const streamFailed = expectOk(
      await normalizeHostEvent(
        codexInput("exec-stream-command-failed.json", { sessionId: "codex-sess-0001" }),
      ),
    );
    expect(hookOk.idempotencyKey).not.toBe(streamFailed.idempotencyKey);
  });

  it("uses the turn id when no tool call id exists (PermissionRequest)", async () => {
    const first = expectOk(
      await normalizeHostEvent(codexInput("permission-request-bash.json")),
    );
    const otherTurn = expectOk(
      await normalizeHostEvent(
        codexInput("permission-request-bash.json", {
          raw: {
            ...codexFixture("permission-request-bash.json"),
            turn_id: "turn-codex-9999",
          },
        }),
      ),
    );
    expect(first.idempotencyKey).not.toBe(otherTurn.idempotencyKey);
  });

  it("distinguishes lifecycle events by their discriminator (source)", async () => {
    const startup = expectOk(await normalizeHostEvent(codexInput("session-start.json")));
    const resume = expectOk(
      await normalizeHostEvent(
        codexInput("session-start.json", {
          raw: { ...codexFixture("session-start.json"), source: "resume" },
        }),
      ),
    );
    expect(startup.idempotencyKey).not.toBe(resume.idempotencyKey);
  });

  it("never collides across hosts", async () => {
    const codex = expectOk(await normalizeHostEvent(codexInput("session-start.json")));
    const claude = expectOk(
      await normalizeHostEvent({
        host: "claude-code",
        raw: {
          session_id: "codex-sess-0001",
          transcript_path: "/tmp/t.jsonl",
          cwd: "/tmp",
          hook_event_name: "SessionStart",
          source: "startup",
        },
      }),
    );
    expect(codex.idempotencyKey).not.toBe(claude.idempotencyKey);
    expect(codex.sessionId).not.toBe(claude.sessionId);
  });

  it("keeps distinct PermissionRequest occurrences apart via the raw-content hash", async () => {
    // Both hosts' PermissionRequest carries no tool_use_id; two different
    // Bash calls in the same turn must NOT share a key.
    const first = expectOk(
      await normalizeHostEvent(codexInput("permission-request-bash.json")),
    );
    const second = expectOk(
      await normalizeHostEvent(
        codexInput("permission-request-bash.json", {
          raw: {
            ...codexFixture("permission-request-bash.json"),
            tool_input: { command: "git push --force" },
          },
        }),
      ),
    );
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("gives each stream delta of one tool call its own key", async () => {
    const deltaA = expectOk(
      await normalizeHostEvent({
        host: "codex",
        sessionId: "codex-sess-0001",
        raw: {
          type: "item.updated",
          item: {
            id: "toolu_codex_delta",
            type: "command_execution",
            command: "npm run build",
            status: "in_progress",
            aggregated_output: "first chunk",
          },
        },
      }),
    );
    const deltaB = expectOk(
      await normalizeHostEvent({
        host: "codex",
        sessionId: "codex-sess-0001",
        raw: {
          type: "item.updated",
          item: {
            id: "toolu_codex_delta",
            type: "command_execution",
            command: "npm run build",
            status: "in_progress",
            aggregated_output: "second chunk",
          },
        },
      }),
    );
    expect(deltaA.idempotencyKey).not.toBe(deltaB.idempotencyKey);
  });

  it("keeps featureless turn.started lines apart only when the reader supplies an occurrence", async () => {
    const without = async (): Promise<string> =>
      expectOk(
        await normalizeHostEvent({
          host: "codex",
          sessionId: "codex-sess-0001",
          raw: { type: "turn.started" },
        }),
      ).idempotencyKey;
    // Without an occurrence identity the byte-identical lines share a key —
    // the documented honest degradation.
    expect(await without()).toBe(await without());
    const first = expectOk(
      await normalizeHostEvent({
        host: "codex",
        sessionId: "codex-sess-0001",
        raw: { type: "turn.started" },
        occurrence: 1,
      }),
    );
    const second = expectOk(
      await normalizeHostEvent({
        host: "codex",
        sessionId: "codex-sess-0001",
        raw: { type: "turn.started" },
        occurrence: 2,
      }),
    );
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("scopes keys by the caller-bound project id", async () => {
    const derived = expectOk(await normalizeHostEvent(codexInput("pre-tool-use-bash.json")));
    const bound = expectOk(
      await normalizeHostEvent(
        codexInput("pre-tool-use-bash.json", {
          projectId: "01AN4Z07BY79KA1307SR9X4MV3",
        }),
      ),
    );
    expect(bound.projectId).toBe("01AN4Z07BY79KA1307SR9X4MV3");
    expect(derived.idempotencyKey).not.toBe(bound.idempotencyKey);
  });
});

describe("buildIdempotencyKey / buildActionFingerprint / deriveDeterministicId", () => {
  const action: ActionDescriptor = {
    toolName: "Bash",
    category: "execute",
    reversible: false,
    external: false,
    resourceRefs: ["C:/users/alice/file.ts"],
  };

  it("builds a stable fingerprint from the action semantics", () => {
    const fingerprint = buildActionFingerprint(action);
    expect(fingerprint).toBe("Bash|execute|C:/users/alice/file.ts");
    const reordered: ActionDescriptor = {
      ...action,
      resourceRefs: ["C:/users/alice/file.ts"],
    };
    expect(buildActionFingerprint(reordered)).toBe(fingerprint);
    expect(buildActionFingerprint(undefined)).toBe("-");
  });

  it("is deterministic for identical inputs and distinct across phases", async () => {
    const base: Omit<IdempotencyKeyInput, "phase"> = {
      host: "codex",
      sessionId: "5A86VWS1MD4MX66HAJXYY3RW3M",
      projectId: "01AN4Z07BY79KA1307SR9X4MV3",
      nativeEventName: "PreToolUse",
      toolCallId: "toolu_01",
      actionFingerprint: buildActionFingerprint(action),
    };
    const a = await buildIdempotencyKey({ ...base, phase: "pre" });
    const b = await buildIdempotencyKey({ ...base, phase: "pre" });
    const c = await buildIdempotencyKey({ ...base, phase: "post" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("derives deterministic 26-char ULIDs from a namespace and input", async () => {
    const id = await deriveDeterministicId("session", "codex|codex-sess-0001");
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const again = await deriveDeterministicId("session", "codex|codex-sess-0001");
    expect(id).toBe(again);
    const other = await deriveDeterministicId("session", "codex|codex-sess-0002");
    expect(id).not.toBe(other);
    const namespaced = await deriveDeterministicId("task", "codex|codex-sess-0001");
    expect(namespaced).not.toBe(id);
  });
});
