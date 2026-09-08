import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { migrateKernelProject } from "../../../packages/core/src/index.js";
import { productionUiProject } from "../ui-factory.js";

test("F04: focus and explicit state refresh retain unsaved suggestion text", async ({
  page,
}) => {
  const fixture = await productionUiProject();
  await migrateKernelProject({ projectRoot: fixture.root });
  const server = await createResearchRoomServer({
    languagePreferenceStore: {
      readLanguage: async () => "en",
      writeLanguage: async () => {},
    },
  }).start();
  try {
    await page.goto(`${server.origin}/project/kernel`);
    await page
      .getByRole("textbox", { name: "Project folder", exact: true })
      .fill(fixture.root);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await page.getByRole("button", { name: "New review", exact: true }).click();
    await page
      .getByRole("textbox", { name: "New suggestion", exact: true })
      .fill("Synthetic saved suggestion");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "Suggestion",
      exact: true,
    });
    await editor.fill("Synthetic unsaved revision 中文");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page
      .getByRole("button", { name: "Reload state", exact: true })
      .click();
    await expect(editor).toHaveValue("Synthetic unsaved revision 中文");
    let release!: () => void, reached!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      saved = new Promise<void>((resolve) => {
        reached = resolve;
      });
    await page.route("**/api/kernel/reviews", async (route) => {
      if (route.request().postDataJSON().action !== "edit")
        return route.continue();
      const response = await route.fetch();
      reached();
      await held;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await saved;
    await editor.fill("Typed while the saved acknowledgement is delayed");
    release();
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeEnabled();
    await expect(editor).toHaveValue(
      "Typed while the saved acknowledgement is delayed",
    );
    await page.unroute("**/api/kernel/reviews");
    await page.getByRole("link", { name: "Project", exact: true }).click();
    const modal = page.getByRole("dialog", {
      name: "Save before leaving?",
      exact: true,
    });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Stay here", exact: true }).click();
    await expect(editor).toHaveValue(
      "Typed while the saved acknowledgement is delayed",
    );
    const original = page.url();
    await page.goBack();
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Stay here", exact: true }).click();
    await expect(page).toHaveURL(original);
    await page.getByRole("link", { name: "Project", exact: true }).click();
    await modal
      .getByRole("button", { name: "Save draft and leave", exact: true })
      .click();
    await expect(page).toHaveURL(/\/project\/state$/);
    await page.goBack();
    await expect(editor).toHaveValue(
      "Typed while the saved acknowledgement is delayed",
    );
  } finally {
    await server.close();
    await fixture.cleanup();
  }
});
