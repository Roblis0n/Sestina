import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("RI-43 standalone local Pilot", () => {
  it("runs the complete synthetic workflow under a proven no-network guard", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts", "verify-pilot-no-network.mjs")],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      },
    );
    expect(JSON.parse(output)).toEqual({
      ok: true,
      networkCanary: "blocked",
      outboundAttempts: 0,
      projectBytesChanged: false,
      syntheticOnly: true,
    });
  }, 60_000);
});
