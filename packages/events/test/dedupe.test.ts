import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  dedupeHostStreamEvent,
  normalizeHostEventDetailed,
  type NormalizedHostEvent,
  type Result,
} from "../src/index.js";

const CODEX = resolve(import.meta.dirname, "../../../tests/fixtures/hooks/codex");

function fixture(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(CODEX, name), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`fixture ${name} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function expectOk<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

async function stream(name: string, sessionId = "codex-sess-0001"): Promise<NormalizedHostEvent> {
  return expectOk(
    await normalizeHostEventDetailed({
      host: "codex",
      raw: fixture(name),
      sessionId,
    }),
  );
}

/**
 * Host-stream dedupe spec.
 *
 * dedupeHostStreamEvent collapses repeated stream events for the SAME tool
 * call (item.started / item.updated / item.completed deltas) into the latest
 * state. Identity = host + sessionId + host tool call id. The latest state
 * wins (last by occurredAt, ties broken by input order). Events of a
 * different session, a different tool call, or non-stream eventTypes pass
 * through untouched.
 */
describe("dedupeHostStreamEvent", () => {
  it("collapses started/updated/completed deltas into the latest state", async () => {
    const started = await stream("exec-stream-command-started.json");
    const completed = await stream("exec-stream-command-completed.json");
    const deduped = dedupeHostStreamEvent([started, completed]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.hostToolCallId).toBe("toolu_codex_01bash");
    // latest state wins
    expect(deduped[0]?.event.action?.securitySummary).toContain("completed");
  });

  it("keeps distinct tool calls", async () => {
    const bash = await stream("exec-stream-command-completed.json");
    const fileChange = await stream("exec-stream-file-change.json");
    const mcp = await stream("exec-stream-mcp.json");
    const deduped = dedupeHostStreamEvent([bash, fileChange, mcp]);
    expect(deduped).toHaveLength(3);
  });

  it("keeps the same tool call id in different sessions apart", async () => {
    const a = await stream("exec-stream-command-completed.json", "codex-sess-0001");
    const b = await stream("exec-stream-command-completed.json", "codex-sess-9999");
    const deduped = dedupeHostStreamEvent([a, b]);
    expect(deduped).toHaveLength(2);
  });

  it("passes non-host_stream events through untouched", async () => {
    const hook = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        raw: fixture("post-tool-use-bash.json"),
      }),
    );
    const streamed = await stream("exec-stream-command-completed.json");
    const deduped = dedupeHostStreamEvent([hook, streamed, hook]);
    expect(deduped).toHaveLength(3);
    expect(deduped.filter((e) => e.event.eventType !== "host_stream")).toHaveLength(2);
  });

  it("returns an empty array for an empty input", () => {
    expect(dedupeHostStreamEvent([])).toEqual([]);
  });

  it("prefers the terminal phase over a later-arriving non-terminal delta", async () => {
    const completed = await stream("exec-stream-command-completed.json");
    // A stale in_progress delta normalized AFTER the terminal event: it has
    // a later occurredAt but a non-terminal phase, so it must not overwrite
    // the completed state.
    const staleDelta = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        sessionId: "codex-sess-0001",
        raw: {
          type: "item.updated",
          item: {
            id: "toolu_codex_01bash",
            type: "command_execution",
            command: "npm test",
            status: "in_progress",
            aggregated_output: "stale delta",
          },
        },
      }),
    );
    const deduped = dedupeHostStreamEvent([completed, staleDelta]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.event.action?.securitySummary).toContain("completed");
  });
});
