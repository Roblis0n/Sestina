import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { desktopResources } from "./lib/target-verification.mjs";
import { desktopExecutable } from "./lib/desktop-distribution.mjs";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(resolve(process.argv[3]), "utf8"));
const resources = desktopResources(directory, manifest.platform);
const desktopRequire = createRequire(join(root, "apps/desktop/package.json"));
const builderRequire = createRequire(
  desktopRequire.resolve("electron-builder"),
);
const asar = createRequire(builderRequire.resolve("app-builder-lib"))(
  "@electron/asar",
);
const archive = join(resources, "app.asar");
const extract = (path) => asar.extractFile(archive, path).toString("utf8");
const identity = JSON.parse(extract("dist/identity.json"));
if (identity.sourceCommit !== manifest.sourceCommit || identity.schema !== 25)
  throw Error("cutover_identity_mismatch");
const renderer = JSON.parse(extract("dist/renderer-inputs.json"));
const runtime = JSON.parse(extract("dist/runtime-inputs.json"));
if (
  !renderer.some((path) => path.endsWith("/app/DesktopApp.tsx")) ||
  !renderer.some((path) => path.endsWith("/api/desktop-client.ts")) ||
  renderer.some((path) =>
    /(?:\/app\/App\.tsx|\/screens\/(?:ProjectShell|StartCenter|BriefSetup)\.tsx|\/api\/client\.ts|\/RecoveryDialog\.tsx)$/.test(
      path,
    ),
  )
)
  throw Error("cutover_renderer_graph_invalid");
if (
  !runtime.length ||
  runtime.some((path) =>
    /(?:packages\/core\/test\/|apps\/research-room\/src\/server\.ts)/.test(
      path.replaceAll("\\", "/"),
    ),
  )
)
  throw Error("cutover_runtime_graph_invalid");
const main = extract("dist/main.cjs");
const companion = (
  await Promise.all(
    ["main.js", "runtime.js", "index.js"].map((file) =>
      readFile(join(resources, "companion", file), "utf8"),
    ),
  )
).join("\n");
for (const code of [main, companion])
  if (
    /\b(?:var|class)\s+(?:SestinaCore\d*|ResearchRoomService|DeliberationRoomService|ClosedExternalAppPilotService|CorrectionAppealService|ProjectMemoryService)\b/.test(
      code,
    )
  )
    throw Error("cutover_old_active_service_present");
const output = resolve(
  process.env.SESTINA_TARGET_OUTPUT ?? ".tmp/target/cutover",
);
await mkdir(output, { recursive: true });
const executable = join(
  directory,
  desktopExecutable(manifest, manifest.platform),
);
const env = {
  ...process.env,
  SESTINA_TARGET_OUTPUT: output,
  SESTINA_TEST_INSTALLED_EXECUTABLE: executable,
};
delete env.SESTINA_TEST_ALLOW_DEVELOPMENT;
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(
  process.execPath,
  [
    join(root, "node_modules/vite-node/vite-node.mjs"),
    "--config",
    "tests/post-0.2/vitest.foundation.config.ts",
    "tests/desktop/installed-cutover.ts",
  ],
  { cwd: root, env, windowsHide: true, stdio: "inherit" },
);
const observed = JSON.parse(
  await readFile(join(output, "result.json"), "utf8"),
);
if (
  !observed.passed ||
  observed.packaged !== true ||
  observed.checks?.length !== 5
)
  throw Error("cutover_installed_checks_incomplete");
console.log(
  JSON.stringify({
    passed: true,
    identity,
    checks: [
      "installed-renderer-and-runtime-exclude-legacy-active-services",
      ...observed.checks,
    ],
    observation: observed,
  }),
);
