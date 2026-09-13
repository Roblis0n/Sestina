import { _electron, expect } from "@playwright/test";
import { strict as assert } from "node:assert";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { mkdir, cp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { workspaceVolumeFixture } from "../post-0.2/workspace-volume-fixture.js";

const executablePath = process.env.SESTINA_TEST_INSTALLED_EXECUTABLE;
if (!executablePath) throw Error("installed_executable_required");
const output = resolve(
  process.env.SESTINA_TARGET_OUTPUT ?? ".tmp/target/performance",
);
await mkdir(output, { recursive: true });
const f = await workspaceVolumeFixture();
f.kernel.close();
// Preserve the original seeded input before measured commands add any data.
await cp(f.root, join(output, "large-project-base"), {
  recursive: true,
  errorOnExist: true,
});
const samples: Record<string, number[]> = {
  coldStartup: [],
  warmStartup: [],
  today: [],
  project: [],
  search: [],
  nextPage: [],
  draft: [],
  manifest: [],
  transaction: [],
};
const resources: unknown[] = [];
const cases: string[] = [];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let identity: any;
let electron: Awaited<ReturnType<typeof _electron.launch>> | undefined;
let page: any, session: any;
const request = async (action: string, body: object = {}) => {
  const result = await page.evaluate(
    (input: any) => window.sestinaDesktop.commands[input.action](input),
    {
      action,
      projectId: session.projectId,
      sessionGeneration: session.sessionGeneration,
      ...body,
    },
  );
  if (!result.ok) throw Error(`${action}: ${JSON.stringify(result.error)}`);
  return result.value;
};
const timed = async (name: string, action: () => Promise<any>) => {
  const start = performance.now();
  const result = await action();
  samples[name]!.push(performance.now() - start);
  return result;
};
const launch = async (profile: string) => {
  electron = await _electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    env,
  });
  page = await electron.firstWindow();
  await page.waitForFunction(() => Boolean(window.sestinaDesktop));
  assert.equal(await electron.evaluate(({ app }) => app.isPackaged), true);
  identity = await electron.evaluate(async ({ app }) =>
    JSON.parse(
      await (process as any).mainModule
        .require("node:fs/promises")
        .readFile(`${app.getAppPath()}/dist/identity.json`, "utf8"),
    ),
  );
  await electron.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, f.root);
  await page
    .getByRole("button", { name: "Choose folder", exact: true })
    .click();
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Current research", exact: true }),
  ).toBeVisible();
  session = await page.evaluate(
    async () => (await window.sestinaDesktop.methods.kernelStatus()).value,
  );
};
try {
  for (let i = 0; i < 20; i++) {
    const profile = join(output, `profile-${i}`);
    await mkdir(profile, { recursive: true });
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
    await timed("coldStartup", () => launch(profile));
    await page.evaluate(() => window.sestinaDesktop.methods.closeProject());
    await electron!.close();
    await timed("warmStartup", () => launch(profile));
    if (i < 19) {
      await page.evaluate(() => window.sestinaDesktop.methods.closeProject());
      await electron!.close();
    }
  }
  cases.push("20-fresh-profile-and-20-existing-profile-process-starts");
  for (let i = 0; i < 25; i++) {
    for (const view of ["today", "project", "search"]) {
      const result = await timed(view, () =>
        request("workspace", { query: { view, limit: 50 } }),
      );
      assert.ok(result.items.length <= 50);
      if (view === "search") {
        assert.ok(result.nextCursor);
        await timed("nextPage", () =>
          request("workspace", {
            query: { view, limit: 50, cursor: result.nextCursor },
          }),
        );
      }
    }
    const review = await timed("draft", () =>
      request("create", { suggestion: `Synthetic measured draft ${i}` }),
    );
    await timed("manifest", () =>
      request("prepare_manifest", {
        reviewId: review.id,
        expectedVersion: review.version,
        selection: {},
        useProvider: false,
      }),
    );
    const current = (await request("read", { reviewId: review.id })).review;
    const skipped = await request("skip_assessment", {
      reviewId: review.id,
      expectedVersion: current.version,
    });
    const prepared = await request("prepare_effect", {
      reviewId: review.id,
      expectedVersion: skipped.version,
      payload: {
        kind: "record_only",
        outcome: "reference_only",
        reason: "Synthetic timing sample",
      },
    });
    await timed("transaction", () =>
      request("commit", {
        reviewId: review.id,
        expectedVersion: prepared.version,
        previewHash: prepared.effectDraft.previewHash,
        authorityCommandId: prepared.effectDraft.authorityCommandId,
      }),
    );
  }
  cases.push("25-real-ipc-samples-per-query-and-write");
  for (let i = 0; i < 100; i++) {
    await page
      .getByRole("link", {
        name: i % 2 ? "Today / Review" : "Project",
        exact: true,
      })
      .click();
    if (i % 10 === 0)
      resources.push(
        await electron!.evaluate(({ app }) => app.getAppMetrics()),
      );
  }
  cases.push("100-real-navigation-switches-resource-samples");
  const p95 = Object.fromEntries(
    Object.entries(samples).map(([name, data]) => [
      name,
      [...data].sort((a, b) => a - b)[Math.ceil(data.length * 0.95) - 1],
    ]),
  );
  const limits = {
    coldStartup: 4000,
    warmStartup: 2000,
    today: 750,
    project: 750,
    search: 500,
    nextPage: 400,
    draft: 1000,
    manifest: 1000,
    transaction: 500,
  };
  const violations = Object.entries(limits).filter(
    ([name, limit]) => p95[name]! > limit,
  );
  const result = {
    passed: violations.length === 0,
    identity,
    cases,
    seed: f.seed,
    fixture: join(output, "large-project-base"),
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    samples,
    p95,
    limits,
    violations,
    resources,
    startupDefinition:
      "fresh process plus actual project opening to rendered Today; cold=fresh profile, warm=existing profile; OS cache not forcibly evicted",
    nativeDialogs: "test_answers_not_native_acceptance",
  };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  assert.equal(result.passed, true, JSON.stringify({ p95, violations }));
  console.log(JSON.stringify({ passed: true, p95, output }));
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(
      { passed: false, identity, cases, samples, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (electron) {
    await page
      ?.evaluate(() => window.sestinaDesktop.methods.closeProject())
      .catch(() => undefined);
    await electron.close().catch(() => undefined);
  }
  // Retain the seeded input and measured project for reproducibility.
}
