import { describe, expect, it } from "vitest";
import {
  collectResourcePathCandidates,
  normalizePathText,
  normalizeResourcePaths,
} from "../src/index.js";

/**
 * Path normalization spec.
 *
 * Rules (documented in resource-normalizer.ts):
 * - Windows-form paths (backslash separators, drive letters, UNC, \\?\ device
 *   prefixes) are case-folded and separator-normalized; POSIX-form paths keep
 *   their case.
 * - `..`/`.` segments are collapsed lexically. The normalizer never touches the
 *   filesystem, so symlink/junction RESULT paths are normalized textually only —
 *   resolving symlinks is out of scope and honestly documented.
 * - The original path text's sha256 is kept available (originalHash) so
 *   governance can still match the host's exact spelling.
 */
describe("normalizePathText", () => {
  const MATRIX: readonly { input: string; expected: string }[] = [
    // drive letter case + backslashes + Windows case folding
    {
      input: "C:\\Users\\alice\\projects\\demo\\src\\app.ts",
      expected: "C:/users/alice/projects/demo/src/app.ts",
    },
    // drive letter lowercase on input still normalizes to uppercase drive
    {
      input: "c:\\Users\\Alice\\File.TS",
      expected: "C:/users/alice/file.ts",
    },
    // `..` collapse on Windows paths
    {
      input: "C:\\Users\\alice\\projects\\..\\projects\\demo\\file.ts",
      expected: "C:/users/alice/projects/demo/file.ts",
    },
    // device path prefix (\\?\C:\...) is stripped
    {
      input: "\\\\?\\C:\\Users\\alice\\file.ts",
      expected: "C:/users/alice/file.ts",
    },
    // \??\ device prefix variant
    {
      input: "\\??\\C:\\Users\\alice\\file.ts",
      expected: "C:/users/alice/file.ts",
    },
    // UNC paths: server/share case-folded, kept distinct from drives
    {
      input: "\\\\Server\\Share\\dir\\file.txt",
      expected: "//server/share/dir/file.txt",
    },
    // UNC with forward slashes on input
    {
      input: "//Server/Share/dir/file.txt",
      expected: "//server/share/dir/file.txt",
    },
    // POSIX paths keep case, collapse `..`
    {
      input: "/Users/alice/projects/../projects/demo/file.ts",
      expected: "/Users/alice/projects/demo/file.ts",
    },
    // POSIX case is preserved (Linux is case-sensitive)
    {
      input: "/Users/Alice/Projects/File.ts",
      expected: "/Users/Alice/Projects/File.ts",
    },
    // relative leading `..` is kept (cannot be resolved without the fs)
    {
      input: "../demo/file.ts",
      expected: "../demo/file.ts",
    },
    // relative inner `..` collapses
    {
      input: "src/../lib/file.ts",
      expected: "lib/file.ts",
    },
    // duplicate separators collapse
    {
      input: "C:\\\\Users\\\\alice\\\\file.ts",
      expected: "C:/users/alice/file.ts",
    },
    // forward-slash Windows drive path is still detected as Windows
    {
      input: "C:/Users/Alice/File.ts",
      expected: "C:/users/alice/file.ts",
    },
    // JSON-escaped forms arrive after JSON.parse as single backslashes and
    // normalize identically to unescaped forms
    {
      input: "C:\\Users\\alice\\file.ts",
      expected: "C:/users/alice/file.ts",
    },
    // symlink/junction result paths: text-only normalization (limitation)
    {
      input: "C:\\Users\\alice\\link\\file.ts",
      expected: "C:/users/alice/link/file.ts",
    },
    // POSIX symlink result path: text-only normalization (limitation)
    {
      input: "/Users/alice/link/file.ts",
      expected: "/Users/alice/link/file.ts",
    },
    // bare drive (no slash) passes through untouched
    { input: "C:", expected: "C:" },
    // empty input stays empty
    { input: "", expected: "" },
  ];

  for (const row of MATRIX) {
    it(`normalizes ${JSON.stringify(row.input)} -> ${row.expected}`, () => {
      expect(normalizePathText(row.input)).toBe(row.expected);
    });
  }
});

describe("normalizeResourcePaths", () => {
  it("returns path refs plus a 64-hex sha256 of the original text", async () => {
    const result = await normalizeResourcePaths([
      "C:\\Users\\alice\\file.ts",
      "/Users/Alice/File.ts",
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.normalized).toBe("C:/users/alice/file.ts");
    expect(result[0]?.originalHash).toMatch(/^[a-f0-9]{64}$/);
    // the hash records the ORIGINAL spelling, so distinct spellings that
    // normalize to the same path keep distinct hashes
    const dup = await normalizeResourcePaths([
      "C:\\Users\\alice\\file.ts",
      "c:\\users\\alice\\file.ts",
    ]);
    expect(dup[0]?.originalHash).not.toBe(dup[1]?.originalHash);
    expect(dup[0]?.normalized).toBe(dup[1]?.normalized);
  });
});

describe("collectResourcePathCandidates", () => {
  it("extracts file_path from Write/Edit/Read inputs", () => {
    expect(
      collectResourcePathCandidates("Write", {
        file_path: "C:\\Users\\alice\\projects\\demo\\src\\app.ts",
        content: "x",
      }),
    ).toEqual(["C:\\Users\\alice\\projects\\demo\\src\\app.ts"]);
    expect(
      collectResourcePathCandidates("Read", {
        file_path: "/Users/alice/projects/demo/src/app.ts",
      }),
    ).toEqual(["/Users/alice/projects/demo/src/app.ts"]);
  });

  it("extracts path from Glob/Grep and planFilePath from ExitPlanMode", () => {
    expect(collectResourcePathCandidates("Glob", { pattern: "**/*.ts", path: "/tmp/x" })).toEqual([
      "/tmp/x",
    ]);
    expect(
      collectResourcePathCandidates("ExitPlanMode", {
        plan: "## Plan",
        planFilePath: "/Users/alice/plans/refactor.md",
      }),
    ).toEqual(["/Users/alice/plans/refactor.md"]);
  });

  it("parses only the fixed apply_patch file markers, never hunk contents", () => {
    const candidates = collectResourcePathCandidates("apply_patch", {
      command:
        "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** Add File: docs/new.md\n*** End Patch",
    });
    expect(candidates).toEqual(["src/app.ts", "docs/new.md"]);
  });

  it("extracts change paths from apply_patch changes arrays", () => {
    expect(
      collectResourcePathCandidates("apply_patch", {
        changes: [{ path: "src/app.ts", kind: "update" }],
      }),
    ).toEqual(["src/app.ts"]);
  });

  it("resolves relative candidates against the event cwd", () => {
    // The join uses "/" — the raw candidate is normalized afterwards by
    // normalizePathText, which is where separator unification happens.
    expect(
      collectResourcePathCandidates(
        "apply_patch",
        { command: "*** Update File: src/app.ts\n*** End Patch" },
        "C:\\Users\\alice\\projects\\demo",
      ),
    ).toEqual(["C:\\Users\\alice\\projects\\demo/src/app.ts"]);
  });

  it("does not treat URLs as file paths (WebFetch/WebSearch)", () => {
    expect(
      collectResourcePathCandidates("WebFetch", {
        url: "https://example.com/api",
        prompt: "Extract",
      }),
    ).toEqual([]);
    expect(collectResourcePathCandidates("WebSearch", { query: "x" })).toEqual([]);
  });

  it("does not parse Bash commands for paths (documented limitation)", () => {
    expect(
      collectResourcePathCandidates("Bash", {
        command: "rm -rf /Users/alice/important",
      }),
    ).toEqual([]);
  });

  it("scans shallow path keys for MCP and unknown tools", () => {
    expect(
      collectResourcePathCandidates("mcp__fs__read", {
        file_path: "/tmp/a.txt",
        other: "not a path",
      }),
    ).toEqual(["/tmp/a.txt"]);
    expect(
      collectResourcePathCandidates("update_plan", { path: "/tmp/plan.md" }),
    ).toEqual(["/tmp/plan.md"]);
  });
});
