import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const requireDesktop = createRequire(join(root, "apps/desktop/package.json"));
const electron = requireDesktop("electron");
const directory = await mkdtemp(join(tmpdir(), "sestina-electron-check-"));
try {
  await cp(
    join(root, "apps/desktop/dist/node_modules"),
    join(directory, "node_modules"),
    { recursive: true },
  );
  const entry = join(directory, "runtime.mjs"),
    report = join(directory, "report.json");
  await build({
    entryPoints: [join(root, "tests/desktop/runtime-probe.ts")],
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["electron", "@primno/dpapi", "@napi-rs/keyring"],
    alias: {
      "@sestina/application": join(root, "packages/application/src/index.ts"),
      "@sestina/secrets": join(root, "packages/secrets/src/index.ts"),
    },
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(electron, [entry, `--report=${report}`], {
      env,
      stdio: "pipe",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Electron runtime probe timed out"));
    }, 90000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
  const result = JSON.parse(await readFile(report, "utf8"));
  if (
    code !== 0 ||
    !result.passed ||
    result.processType !== "browser" ||
    !result.versions.electron
  )
    throw new Error("Electron runtime probe failed");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
