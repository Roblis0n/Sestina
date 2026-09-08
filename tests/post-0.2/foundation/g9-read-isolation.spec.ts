import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { migrateKernelProject } from "../../../packages/core/src/index.js";
import { productionUiProject } from "../ui-factory.js";

test("G9: searching Brief boundaries opens readable Brief content and survives its object deep link", async ({
  page,
}) => {
  const f = await productionUiProject();
  await migrateKernelProject({ projectRoot: f.root });
  const server = await createResearchRoomServer({
    languagePreferenceStore: {
      readLanguage: async () => "en",
      writeLanguage: async () => {},
    },
  }).start();
  try {
    await page.goto(server.origin + "/project/today");
    await page
      .getByRole("textbox", { name: "Project folder", exact: true })
      .fill(f.root);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search research", exact: true })
      .fill("Scan arbitrary project files");
    await expect(page.locator(".task-list li")).toHaveCount(1);
    await page
      .locator(".task-list li")
      .getByRole("button", { name: "View details", exact: true })
      .click();
    await expect(page.locator(".project-brief-panel dl").first()).toBeVisible();
    await expect(page.locator(".project-brief-panel")).toContainText(
      "Scan arbitrary project files",
    );
    await page.reload();
    await expect(page.locator(".project-brief-panel dl").first()).toBeVisible();
    await page.screenshot({
      path: ".tmp/g8-g9/visual/brief-search-detail.png",
    });
  } finally {
    await server.close();
    await f.cleanup();
  }
});

test("G9: delayed real query results cannot replace a newer search or a closed session", async ({
  page,
}) => {
  const f = await productionUiProject();
  await migrateKernelProject({ projectRoot: f.root });
  const server = await createResearchRoomServer({
    languagePreferenceStore: {
      readLanguage: async () => "en",
      writeLanguage: async () => {},
    },
  }).start();
  let release = () => {};
  try {
    await page.goto(server.origin + "/project/today");
    await page
      .getByRole("textbox", { name: "Project folder", exact: true })
      .fill(f.root);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await page.getByRole("link", { name: "Search", exact: true }).click();
    let reached = () => {};
    const waiting = new Promise<void>((r) => {
        reached = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      });
    await page.route("**/api/kernel/reviews", async (route) => {
      const request = route.request().postDataJSON();
      if (
        request.action === "workspace" &&
        request.query?.query === "Dispute"
      ) {
        const response = await route.fetch();
        reached();
        await held;
        await route.fulfill({ response }).catch(() => {});
      } else await route.continue();
    });
    const search = page.getByRole("searchbox", {
      name: "Search research",
      exact: true,
    });
    await search.fill("Dispute");
    await waiting;
    await search.fill("Keep every authority");
    await expect(page.locator(".task-list")).toContainText(
      "Keep every authority",
    );
    release();
    await expect(page.locator(".task-list")).not.toContainText(
      "Dispute an alleged",
    );
    await page
      .getByRole("button", { name: "Switch project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Open your research", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".task-list")).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Open your research", exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await server.close();
    await f.cleanup();
  }
});
