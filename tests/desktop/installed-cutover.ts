import { _electron, expect } from "@playwright/test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const output = resolve(
  process.env.SESTINA_TARGET_OUTPUT ?? ".tmp/target/cutover",
);
await mkdir(output, { recursive: true });
const area = await mkdtemp(join(output, "run-")),
  profile = join(area, "profile"),
  project = join(area, "synthetic-project");
await mkdir(profile);
await mkdir(project);
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
const development = process.env.SESTINA_TEST_ALLOW_DEVELOPMENT === "1";
const installed = process.env.SESTINA_TEST_INSTALLED_EXECUTABLE;
if (!installed && !development) throw Error("installed_executable_required");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath:
    installed ??
    createRequire(resolve("apps/desktop/package.json"))("electron"),
  args: [
    ...(installed ? [] : [resolve("apps/desktop")]),
    `--user-data-dir=${profile}`,
  ],
  env,
});
const checks: string[] = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const packaged = await app.evaluate(({ app }) => app.isPackaged);
  assert.equal(packaged, Boolean(installed));
  await expect(
    page.getByRole("heading", { name: "Open your research", exact: true }),
  ).toBeVisible();
  await page.goto("sestina://app/", { timeout: 15000 });
  await expect(
    page.getByRole("heading", { name: "Open your research", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open a migrated project", exact: true }),
  ).toHaveCount(0);
  checks.push("default-and-root-only-open-kernel-entry");
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [project],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, project);
  await page
    .getByRole("button", { name: "Choose folder", exact: true })
    .click();
  await page
    .getByText("Create a project in this folder", { exact: true })
    .click();
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Synthetic final cutover");
  await page
    .getByRole("checkbox", {
      name: "Create a local .sestina folder here. Existing project folders will not be overwritten.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Today / Review", exact: true }),
  ).toBeVisible();
  checks.push("default-ui-creates-real-kernel-project");
  for (const path of [
    "/project/deliberation-rooms/new",
    "/project/external-app-pilots/new",
    "/project/appeals/new",
  ]) {
    await page.evaluate((path) => {
      history.pushState({}, "", path);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await expect(
      page.getByRole("heading", {
        name: "This historical workflow is read-only",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Go to Today", exact: true })
      .click();
  }
  checks.push("old-room-pilot-appeal-new-links-are-read-only");
  const surface = await page.evaluate(() => ({
    commands: Object.keys(window.sestinaDesktop!.commands),
    methods: Object.keys(window.sestinaDesktop!.methods),
    require: typeof (window as any).require,
  }));
  assert.equal(surface.require, "undefined");
  for (const name of [
    "genericCommit",
    "commitResearchRoomDisposition",
    "createDeliberationRoom",
    "createClosedExternalAppPilot",
  ])
    assert.equal(
      [...surface.commands, ...surface.methods].includes(name),
      false,
    );
  checks.push("installed-bridge-has-no-legacy-writer-or-node-loader");
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Open your research", exact: true }),
  ).toBeVisible();
  checks.push("switch-project-returns-to-the-same-kernel-entry");
  await page.screenshot({ path: join(output, "default-entry.png") });
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        packaged,
        checks,
        nativeDialogs: "test_answers_not_native_acceptance",
        area,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, packaged, checks }));
} catch (error) {
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  // The probe owns this isolated app. Do not retain its renderer when an
  // assertion fails or the regular application close handshake is interrupted.
  await app
    .evaluate(({ app }) => {
      setTimeout(() => app.exit(0), 0);
    })
    .catch(() => undefined);
  await app.close().catch(() => undefined);
}
