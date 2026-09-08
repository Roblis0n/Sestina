import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { migrateKernelProject } from "../../../packages/core/src/index.js";
import { productionUiProject } from "../ui-factory.js";

for (const language of ["en", "zh-CN"] as const)
  for (const theme of ["light", "dark", "high_contrast"] as const) {
    test(`P1-04 G6: typed controls persist a real Brief change (${language}, ${theme})`, async ({
      page,
    }, info) => {
      const fixture = await productionUiProject("ready");
      await migrateKernelProject({ projectRoot: fixture.root });
      const server = await createResearchRoomServer({
        languagePreferenceStore: {
          readLanguage: () => Promise.resolve(language),
          writeLanguage: () => Promise.resolve(),
        },
      }).start();
      const en = language === "en";
      try {
        const outbound: string[] = [];
        await page.route("**/*", async (route) => {
          if (new URL(route.request().url()).origin !== server.origin) {
            outbound.push(route.request().url());
            await route.abort();
          } else await route.continue();
        });
        await page.addInitScript(
          ({ theme }) =>
            localStorage.setItem(
              "sestina.app.appearance.v1",
              JSON.stringify({
                version: 1,
                theme,
                reducedMotion: "on",
                reducedTransparency: true,
              }),
            ),
          { theme },
        );
        await page.goto(`${server.origin}/project/kernel`);
        await page
          .getByRole("textbox", {
            name: en ? "Project folder" : "项目文件夹",
            exact: true,
          })
          .fill(fixture.root);
        await page
          .getByRole("button", {
            name: en ? "Open project" : "打开项目",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: en ? "Edit Brief" : "修改简报",
            exact: true,
          })
          .click();
        expect(
          await page
            .locator(".structured-editor textarea.code-input:not([readonly])")
            .count(),
        ).toBe(0);
        expect(
          await page
            .locator(".project-brief-panel textarea.code-input:not([readonly])")
            .count(),
        ).toBe(0);
        await expect(
          page
            .getByRole("combobox", {
              name: en ? "Field state" : "字段状态",
              exact: true,
            })
            .nth(1),
        ).toBeVisible();
        await page
          .getByRole("textbox", {
            name: en ? "Current task" : "当前任务",
            exact: true,
          })
          .fill("Synthetic UI change: retain the evidence boundary.");
        await page
          .getByRole("textbox", {
            name: en ? "Reason for this change" : "本次修改的理由",
            exact: true,
          })
          .fill("Explicit synthetic user change.");
        await page
          .getByRole("button", {
            name: en ? "Save draft" : "保存草稿",
            exact: true,
          })
          .click();
        await expect(
          page.getByText(
            en
              ? "Draft saved. Review the changes before confirming."
              : "草稿已保存，请核对修改后再确认。",
            { exact: true },
          ),
        ).toBeVisible();
        await page
          .getByRole("button", {
            name: en ? "View changes and confirm" : "查看修改并确认",
            exact: true,
          })
          .click();
        await page.reload();
        await expect(
          page.getByRole("heading", {
            name: en ? "Changes to confirm" : "待确认的修改",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText("Synthetic UI change: retain the evidence boundary.", {
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("checkbox", {
            name: en
              ? "I confirm the changes shown above."
              : "我确认以上具体修改。",
            exact: true,
          })
          .check();
        await page
          .getByRole("button", {
            name: en ? "Confirm and save" : "确认并保存",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("status").filter({
            hasText: en ? "Research change saved" : "研究变更已保存",
          }),
        ).toBeVisible();
        await page.reload();
        await page
          .getByText(en ? "Receipt details" : "凭证详情", { exact: true })
          .click();
        await expect(
          page
            .locator("details[open] pre")
            .filter({ hasText: '"effectKind": "patch_brief"' }),
        ).toBeVisible();
        await page
          .getByRole("button", {
            name: en ? "Continue in a new review" : "在新审议中继续",
            exact: true,
          })
          .click();
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: en ? "Draft saved" : "草稿已保存" }),
        ).toBeVisible();
        await page
          .getByRole("link", { name: en ? "Project" : "项目", exact: true })
          .click();
        await page
          .getByRole("link", { name: en ? "Project" : "项目", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: en ? "Research Brief" : "研究简报",
            exact: true,
          })
          .click();
        await expect(
          page.getByText("Synthetic UI change: retain the evidence boundary.", {
            exact: true,
          }),
        ).toBeVisible();
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => document.activeElement?.tagName),
        ).not.toBe("BODY");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath("brief-saved-200-percent.png"),
          fullPage: false,
        });
        expect(outbound).toEqual([]);
      } finally {
        await server.close();
        await fixture.cleanup();
      }
    });
  }
