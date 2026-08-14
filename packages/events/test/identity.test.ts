import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deriveDeterministicId,
  hostIdentityInput,
  hostSessionIdentity,
  normalizeHostEventDetailed,
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
  expect(
    result.ok,
    `expected ok, got: ${JSON.stringify(!result.ok ? result.error.toJSON() : null)}`,
  ).toBe(true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

/**
 * Host-session identity mapping (docs/22 deviation #3): a host session maps
 * to exactly one Sestina session id, deterministically, and the mapping is a
 * single exported canonical function — hook and stream views, correlation,
 * and Task 8's HostSessionService all consume it instead of re-deriving it.
 */
describe("hostSessionIdentity", () => {
  it("derives the same canonical sessionId as the hook and stream views of one host session", async () => {
    const canonical = await hostSessionIdentity("codex", "codex-sess-0001");
    const hook = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        raw: fixture("pre-tool-use-bash.json"),
      }),
    );
    const stream = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        raw: fixture("exec-stream-command-started.json"),
        sessionId: "codex-sess-0001",
      }),
    );
    expect(hook.event.sessionId).toBe(canonical);
    expect(stream.event.sessionId).toBe(canonical);
  });

  it("pins the literal derived identity (frozen once shipped)", async () => {
    const codex = await hostSessionIdentity("codex", "codex-sess-0001");
    expect(codex).toBe("0B0A7FP0VY5MNSV6M2A8Y4RXM8");
    // The host is part of the identity: the same host session id under a
    // different host derives a different Sestina session.
    expect(await hostSessionIdentity("claude_code", "codex-sess-0001")).not.toBe(
      codex,
    );
  });

  it("exposes the host identity input template for project/task derivation", async () => {
    expect(hostIdentityInput("codex", "codex-sess-0001")).toBe(
      "codex\u0000codex-sess-0001",
    );
    const hook = expectOk(
      await normalizeHostEventDetailed({
        host: "codex",
        raw: fixture("pre-tool-use-bash.json"),
      }),
    );
    // project/task namespaces reuse the same canonical input.
    const project = await deriveDeterministicId(
      "project",
      hostIdentityInput("codex", "codex-sess-0001"),
    );
    expect(hook.event.projectId).toBe(project);
  });
});
