import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { migrateKernelProject } from "../../../packages/core/src/index.js";
import { productionUiProject } from "../ui-factory.js";

test("G9: no-provider decision, evidence, issue and direction journeys locate real saved results", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const f = await productionUiProject();
  await migrateKernelProject({ projectRoot: f.root });
  const server = await createResearchRoomServer({
    languagePreferenceStore: {
      readLanguage: async () => "en",
      writeLanguage: async () => {},
    },
  }).start();
  const button = (name: string) =>
      page.getByRole("button", { name, exact: true }),
    textbox = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
  const confirm = async () => {
    await page
      .getByRole("checkbox", {
        name: "I confirm the changes shown above.",
        exact: true,
      })
      .check();
    await button("Confirm and save").click();
    await expect(
      page.getByRole("heading", { name: "Saved result", exact: true }),
    ).toBeVisible();
  };
  try {
    await page.goto(server.origin + "/project/today");
    await textbox("Project folder").fill(f.root);
    await button("Open project").click();
    for (const kind of [
      "create_decision",
      "add_evidence",
      "create_or_resolve_issue",
    ]) {
      await page
        .getByRole("link", { name: "Today / Review", exact: true })
        .click();
      await button("New review").click();
      await textbox("New suggestion").fill(
        `Synthetic ${kind} proposal <script>throw new Error('never execute')</script>`,
      );
      await button("Save draft").click();
      await button("Continue without assessment").click();
      await page
        .getByRole("combobox", { name: "Research action", exact: true })
        .selectOption(kind);
      await textbox("Specific result").fill(`Synthetic saved ${kind} 中文`);
      await textbox("Reason").fill("Explicit synthetic user reason.");
      if (kind === "add_evidence") {
        await page
          .getByRole("combobox", { name: "Evidence type", exact: true })
          .selectOption("literature_source");
        await page
          .getByRole("combobox", { name: "Evidence status", exact: true })
          .selectOption("current");
        await page
          .getByRole("combobox", { name: "Inference range", exact: true })
          .selectOption("background_only");
        await textbox("Source citation").fill(
          "Synthetic source, deliberately not a real citation",
        );
      }
      if (kind === "create_or_resolve_issue") {
        await page
          .getByRole("combobox", { name: "Issue type", exact: true })
          .selectOption("evidence_boundary");
        await textbox("Unmet criterion").fill(
          "The claim needs bounded support",
        );
        await textbox("Related concepts (separated by commas)").fill(
          "scope, observation",
        );
        await page
          .getByRole("checkbox", {
            name: "notes/ui-02-continuity.md Current · Version 2",
            exact: true,
          })
          .check();
      }
      await button("View changes").click();
      await expect(
        page.getByRole("heading", { name: "Changes to confirm", exact: true }),
      ).toBeVisible();
      await confirm();
      const result = page
        .getByRole("heading", { name: "Saved result", exact: true })
        .locator("..");
      await result.getByRole("link").first().click();
      await expect(
        page.getByText(`Synthetic saved ${kind} 中文`, { exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("link", { name: "Project", exact: true }).click();
    await button("Research Brief").click();
    await button("Edit Brief").click();
    await page
      .getByText("Change the research question", { exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Prepare a formal direction change",
        exact: true,
      })
      .check();
    await textbox("New research question").fill(
      "Which explicitly changed question should guide this synthetic research?",
    );
    await textbox("Reason for this change").fill(
      "Explicit synthetic direction decision",
    );
    await button("Save draft").click();
    await button("View changes and confirm").click();
    await confirm();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Saved result", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("direction-saved.png") });
    expect(await page.locator(".kernel-workspace script").count()).toBe(0);
  } finally {
    await server.close();
    await f.cleanup();
  }
});
