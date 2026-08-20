import { vi, describe, expect, it } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    access: async (path: Parameters<typeof original.access>[0], mode?: number): Promise<void> => {
      if (String(path).endsWith("state.sqlite")) {
        throw Object.assign(new Error("synthetic access denial"), { code: "EACCES" });
      }
      await original.access(path, mode);
    },
  };
});

import { resolveProjectStatePaths } from "../src/security/path-guard.js";
import { createProjectFixture, removeProjectFixture } from "./fixture.js";

describe("@sestina/mcp unreadable database path", () => {
  it("maps a database read denial to one stable path-free public error", async () => {
    const fixture = await createProjectFixture();
    try {
      const result = await resolveProjectStatePaths(fixture.root);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "project_state_unavailable" },
      });
      expect(JSON.stringify(result)).not.toContain(fixture.root);
      expect(JSON.stringify(result)).not.toContain(fixture.databasePath);
      expect(JSON.stringify(result)).not.toContain("synthetic access denial");
    } finally {
      await removeProjectFixture(fixture.root);
    }
  });
});
