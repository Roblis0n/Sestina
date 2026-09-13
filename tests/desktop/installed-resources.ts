import { _electron, expect } from "@playwright/test";
import { strict as assert } from "node:assert";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  cp,
  readdir,
  stat,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const executablePath = process.env.SESTINA_TEST_INSTALLED_EXECUTABLE;
if (!executablePath) throw Error("installed_executable_required");
const output = resolve(
  process.env.SESTINA_TARGET_OUTPUT ?? ".tmp/target/resources",
);
await mkdir(output, { recursive: true });
const area = await mkdtemp(join(output, "run-"));
const performanceResult = JSON.parse(
  await readFile(join(dirname(output), "performance/result.json"), "utf8"),
);
if (!performanceResult.passed) throw Error("verified_large_fixture_required");
const projects = [join(area, "large-a"), join(area, "large-b")];
for (const project of projects)
  await cp(performanceResult.fixture, project, { recursive: true });
const profile = join(area, "profile");
await mkdir(profile);
await writeFile(
  join(profile, "preferences.json"),
  JSON.stringify({
    format: "1.0.0",
    language: "en",
    appearance: {
      version: 1,
      theme: "light",
      reducedMotion: "system",
      reducedTransparency: true,
    },
    recentProjects: [],
  }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath,
  args: [`--user-data-dir=${profile}`],
  env,
});
const samples: unknown[] = [],
  maintenance: unknown[] = [],
  checks: string[] = [];
let identity: any;
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  identity = await app.evaluate(async ({ app }) =>
    JSON.parse(
      await (process as any).mainModule
        .require("node:fs/promises")
        .readFile(`${app.getAppPath()}/dist/identity.json`, "utf8"),
    ),
  );
  assert.equal(identity.sourceCommit, performanceResult.identity.sourceCommit);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  const invoke = async (method: string, input: object = {}) => {
    const reply = await page.evaluate(
      ({ method, input }) =>
        (window as any).sestinaDesktop.methods[method](input),
      { method, input },
    );
    if (!reply.ok) throw Error(`${method}:${JSON.stringify(reply.error)}`);
    return reply.value;
  };
  const select = async (projectPath: string) => {
    await app.evaluate(({ dialog }, projectPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [projectPath],
      });
    }, projectPath);
    await page
      .getByRole("button", { name: "Choose folder", exact: true })
      .click();
  };
  const cdp = await page.context().newCDPSession(page);
  const sample = async () => {
    const main = await app.evaluate(({ app }) => ({
      metrics: app.getAppMetrics(),
      memory: process.memoryUsage(),
      listeners: Object.fromEntries(
        process
          .eventNames()
          .map((name) => [String(name), process.listenerCount(name)]),
      ),
      activeHandles: (process as any)._getActiveHandles().length,
    }));
    const ids = main.metrics.map((metric) => metric.pid);
    const handles = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-Process -Id ${ids.join(",")} -ErrorAction Stop | Select-Object Id,HandleCount,WorkingSet64,PeakWorkingSet64 | ConvertTo-Json -Compress`,
        ],
        { windowsHide: true, encoding: "utf8" },
      ),
    );
    return { main, handles, dom: await cdp.send("Memory.getDOMCounters") };
  };
  for (let i = 0; i < 20; i++) {
    await select(projects[i % 2]!);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Current research", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Project", exact: true }).click();
    assert.ok((await page.locator(".task-list li").count()) <= 50);
    await page
      .getByRole("button", { name: "Switch project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Open your research", exact: true }),
    ).toBeVisible();
    samples.push({ iteration: i + 1, ...(await sample()) });
  }
  checks.push(
    "20-real-large-project-switch-close-open-cycles-with-process-handles-listeners-dom-and-memory",
  );
  await select(projects[0]!);
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Current research", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Project", exact: true }).click();
  await page.evaluate(() => {
    (globalThis as any).__longTasks = [];
    const observer = new PerformanceObserver((list) =>
      (globalThis as any).__longTasks.push(
        ...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })),
      ),
    );
    observer.observe({ type: "longtask" });
    (globalThis as any).__longTaskObserver = observer;
  });
  for (let i = 0; i < 50; i++) {
    await page.mouse.wheel(0, i % 10 < 5 ? 300 : -300);
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  }
  const longTasks = await page.evaluate(() => {
    (globalThis as any).__longTaskObserver.disconnect();
    return (globalThis as any).__longTasks;
  });
  assert.equal(
    longTasks.filter((entry: any) => entry.duration > 200).length,
    0,
    "scroll long tasks exceed 200ms",
  );
  checks.push(
    "50-continuous-scroll-inputs-no-long-task-over-200ms-and-paginated-list",
  );
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  async function measureMaintenance(
    action: string,
    projectPath: string,
    input: object = {},
  ) {
    const files = await readdir(join(projectPath, ".sestina"), {
      withFileTypes: true,
    });
    const inputBytes = (
      await Promise.all(
        files
          .filter((file) => file.isFile())
          .map(
            async (file) =>
              (await stat(join(projectPath, ".sestina", file.name))).size,
          ),
      )
    ).reduce((a, b) => a + b, 0);
    const before = await sample();
    const session = await invoke("kernelStatus");
    const start = performance.now();
    const value = await invoke("maintenance", {
      action,
      projectPath,
      sessionGeneration: session.sessionGeneration,
      ...input,
    });
    const durationMs = performance.now() - start;
    maintenance.push({
      action,
      inputBytes,
      durationMs,
      bytesPerSecond: inputBytes / (durationMs / 1000),
      before,
      after: await sample(),
      peakDefinition:
        "OS lifetime peak working set; before/after retained, not instantaneous per-operation allocation",
    });
    return value;
  }
  await select(projects[0]!);
  const backup = await measureMaintenance("backup", projects[0]!);
  assert.ok(backup.backupId);
  const provenance = JSON.parse(
    await readFile(
      resolve("tests/post-0.2/legacy-states-provenance.json"),
      "utf8",
    ),
  );
  const entry = provenance.fixtures.find((item: any) =>
    item.key.startsWith("deliberation"),
  );
  const legacy = join(area, "legacy");
  await cp(
    join(
      dirname(output),
      "journeys/frozen-corpus/states",
      entry.key,
      ".sestina",
    ),
    join(legacy, ".sestina"),
    { recursive: true },
  );
  await select(legacy);
  const state = await invoke("kernelStatus");
  const preview = await invoke("maintenance", {
    action: "preview",
    projectPath: legacy,
    sessionGeneration: state.sessionGeneration,
  });
  await measureMaintenance("migrate", legacy, {
    previewHash: preview.previewHash,
  });
  checks.push(
    "actual-backup-and-frozen-legacy-migration-throughput-and-os-peak-memory",
  );
  const result = {
    passed: true,
    packaged: true,
    identity,
    checks,
    samples,
    maintenance,
    longTasks,
    nativeDialogs: "fixture_answers_not_native_acceptance",
    retentionClaim:
      "raw open-close trend samples, not an unbounded-duration leak proof",
    area,
  };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, checks, output }));
} catch (error) {
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: false,
        identity,
        samples,
        maintenance,
        checks,
        error: String(error),
        area,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app
    .evaluate(({ app }) => {
      setTimeout(() => app.exit(0), 0);
    })
    .catch(() => undefined);
  await app.close().catch(() => undefined);
}
