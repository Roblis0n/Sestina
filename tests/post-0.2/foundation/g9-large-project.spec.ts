import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { workspaceVolumeFixture } from "../workspace-volume-fixture.js";
import { mkdir, writeFile } from "node:fs/promises";

test("G9: real large SQLite project remains paged, searchable and keyboard navigable", async ({
  page,
}) => {
  test.setTimeout(180000);
  const f = await workspaceVolumeFixture();
  f.kernel.close();
  const app = createResearchRoomServer({
    languagePreferenceStore: {
      readLanguage: async () => "en",
      writeLanguage: async () => {},
    },
  });
  const server = await app.start();
  const dir = ".tmp/g8-g9/visual/large";
  await mkdir(dir, { recursive: true });
  const timings: Record<string, number> = {};
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(server.origin + "/project/today");
    await page
      .getByRole("textbox", { name: "Project folder", exact: true })
      .fill(f.root);
    const start = Date.now();
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(page.locator(".task-list li").first()).toBeVisible({
      timeout: 30000,
    });
    timings.openToToday = Date.now() - start;
    expect(await page.locator(".task-list li").count()).toBeLessThanOrEqual(30);
    await page.screenshot({ path: `${dir}/today-1440.png` });
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search research", exact: true })
      .fill("Synthetic claim");
    await expect(page.locator(".task-list li")).toHaveCount(30);
    const titles = await page.locator(".task-list li").allTextContents();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect
      .poll(async () =>
        JSON.stringify(await page.locator(".task-list li").allTextContents()),
      )
      .not.toBe(JSON.stringify(titles));
    await page.screenshot({ path: `${dir}/search-page-two-1440.png` });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(1440);
    await page.getByRole("link", { name: "Project", exact: true }).click();
    await expect(page.locator(".task-list li")).toHaveCount(30);
    await page
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption("claim_evidence_link");
    await expect(page.locator(".task-list li").first()).toContainText(
      "Claim–evidence relationship",
    );
    await page
      .getByRole("button", { name: "View details", exact: true })
      .first()
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".workspace-detail")).toBeVisible();
    await writeFile(
      `${dir}/timing.json`,
      JSON.stringify(
        {
          seed: f.seed,
          timings,
          note: "Single browser observation; not a percentile or packaged startup claim.",
        },
        null,
        2,
      ),
    );
  } finally {
    await server.close();
    await f.cleanup();
  }
});
