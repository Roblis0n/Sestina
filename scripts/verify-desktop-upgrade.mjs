import { build } from "esbuild";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import { _electron } from "@playwright/test";
const root = resolve(import.meta.dirname, ".."),
  area = join(root, ".tmp/g10-g11"),
  entry = join(area, "installed-upgrade-probe.cjs");
const executable = createRequire(join(root, "apps/desktop/package.json"))(
  "electron",
);
await mkdir(area, { recursive: true });
await build({
  entryPoints: [join(root, "tests/desktop/installed-upgrade-probe.ts")],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron", "@primno/dpapi", "@napi-rs/keyring"],
  alias: { "@sestina/core": join(root, "packages/core/src/index.ts") },
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const code = await new Promise((done, reject) => {
  const child = spawn(executable, [entry, `--workspace=${root}`], {
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  child.once("error", reject);
  child.once("exit", done);
});
const report = JSON.parse(
  await readFile(join(area, "installed-upgrade-result.json"), "utf8"),
);
assert.equal(code, 0, JSON.stringify(report));
assert.equal(report.passed, true);
const previous = await _electron.launch({
  executablePath: join(report.restoredProgram, "Sestina Candidate.exe"),
  args: [`--user-data-dir=${join(area, "previous-program-profile")}`],
  env,
});
try {
  await previous.firstWindow();
  assert.equal(
    await previous.evaluate(({ app }) => app.getVersion()),
    report.current.version,
  );
} finally {
  await previous.close();
}
console.log(
  JSON.stringify({ ...report, verifiedPreviousProgramActuallyOpened: true }),
);
