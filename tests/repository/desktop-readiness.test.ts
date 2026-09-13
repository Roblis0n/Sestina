import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectDesktopReadiness,
  remainingDesktopRequirements,
} from "../../scripts/lib/desktop-readiness.mjs";

const temporary: string[] = [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "sestina-readiness-"));
  temporary.push(directory);
  const sourceCommit = "a".repeat(40);
  const artifacts = Object.fromEntries(
    ["win32-x64", "darwin-arm64", "linux-x64"].map((target) => {
      const path = join(directory, `${target}.installer`);
      writeFileSync(path, target);
      return [target, { path, sha256: sha(target) }];
    }),
  );
  const observations = remainingDesktopRequirements.map(
    (requirement: { id: string; target: string; cases: string[] }) => {
      const path = join(directory, `${requirement.id}.json`);
      const result = {
        schema: 1,
        requirement: requirement.id,
        target: requirement.target,
        sourceCommit,
        installerSha256: artifacts[requirement.target].sha256,
        environment: "synthetic verifier fixture; not installation acceptance",
        status: "passed",
        skipped: 0,
        todo: 0,
        cases: requirement.cases.map((id) => ({ id, status: "passed" })),
        evidence: [
          {
            path: artifacts[requirement.target].path,
            sha256: artifacts[requirement.target].sha256,
          },
        ],
      };
      writeFileSync(path, JSON.stringify(result));
      return {
        requirement: requirement.id,
        path,
        sha256: sha(JSON.stringify(result)),
      };
    },
  );
  return {
    input: { schema: 1, sourceCommit, artifacts, observations },
    directory,
  };
}
afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("remaining desktop prerequisites (never a G12 or release verdict)", () => {
  it("replaces a previous successful output when the next inventory is malformed", () => {
    const { input, directory } = fixture();
    const inventory = join(directory, "inventory.json");
    const output = join(directory, "result.json");
    writeFileSync(inventory, JSON.stringify(input));
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "scripts/check-desktop-readiness.mjs",
          "--inventory",
          inventory,
          "--output",
          output,
        ],
        { encoding: "utf8", windowsHide: true },
      );
    expect(run().status).toBe(0);
    writeFileSync(inventory, "invalid inventory");
    expect(run().status).toBe(1);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      remainingPrerequisitesSatisfied: false,
    });
  });
  it("requires every platform and every outstanding observation without requiring G13/publication", () => {
    const { input } = fixture();
    expect(inspectDesktopReadiness(input).remainingPrerequisitesSatisfied).toBe(
      true,
    );
    expect(
      inspectDesktopReadiness({ ...input, observations: [] })
        .remainingPrerequisitesSatisfied,
    ).toBe(false);
    expect(
      inspectDesktopReadiness({ ...input, artifacts: {} })
        .remainingPrerequisitesSatisfied,
    ).toBe(false);
  });

  it("rejects missing files, changed artifacts and changed evidence instead of reusing stale success", () => {
    for (const fault of ["missing", "artifact", "evidence"]) {
      const { input } = fixture();
      if (fault === "missing") rmSync(input.observations[0].path);
      if (fault === "artifact")
        writeFileSync(input.artifacts["win32-x64"].path, "new installer");
      if (fault === "evidence") writeFileSync(input.observations[0].path, "{}");
      expect(
        inspectDesktopReadiness(input).remainingPrerequisitesSatisfied,
        fault,
      ).toBe(false);
    }
  });

  it("rejects wrong source/platform, zero or omitted cases, skip/todo, failure and duplicate receipts", async () => {
    const { readFileSync } = await import("node:fs");
    for (const mutation of [
      { sourceCommit: "b".repeat(40) },
      { target: "linux-x64" },
      { cases: [] },
      { cases: [{ id: "invented", status: "passed" }] },
      { skipped: 1 },
      { todo: 1 },
      { status: "not_run" },
      { status: "failed" },
      { installerSha256: "f".repeat(64) },
      { evidence: [] },
    ]) {
      const { input } = fixture();
      const record = input.observations[0];
      const content = JSON.stringify({
        ...JSON.parse(readFileSync(record.path, "utf8")),
        ...mutation,
      });
      writeFileSync(record.path, content);
      record.sha256 = sha(content);
      expect(
        inspectDesktopReadiness(input).remainingPrerequisitesSatisfied,
        JSON.stringify(mutation),
      ).toBe(false);
    }
    const { input } = fixture();
    input.observations.push(input.observations[0]);
    expect(inspectDesktopReadiness(input).remainingPrerequisitesSatisfied).toBe(
      false,
    );
  });
});
