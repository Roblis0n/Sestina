import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { migrateKernelProject } from "../../../packages/core/src/index.js";
import { productionUiProject } from "../ui-factory.js";
import { mkdir } from "node:fs/promises";

for (const language of ["en", "zh-CN"])
  for (const theme of ["light", "dark", "high_contrast"]) {
    test(`G9 visual journey ${language} ${theme}: four desktop widths, page states and keyboard`, async ({
      page,
    }) => {
      test.setTimeout(90000);
      const fixture = await productionUiProject("long");
      await migrateKernelProject({ projectRoot: fixture.root });
      const server = await createResearchRoomServer({
        languagePreferenceStore: {
          readLanguage: async () => language,
          writeLanguage: async () => {},
        },
      }).start();
      const en = language === "en",
        dir = `.tmp/g8-g9/visual/${language}-${theme}`;
      await mkdir(dir, { recursive: true });
      const outbound: string[] = [];
      const shot = async (name: string) => {
        await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      };
      try {
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
        await page.setViewportSize({ width: 1100, height: 900 });
        await page.goto(server.origin + "/project/today");
        await expect(
          page.getByRole("heading", {
            name: en ? "Open your research" : "打开研究项目",
            exact: true,
          }),
        ).toBeVisible();
        await shot("start-1100");
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
        await expect(
          page.getByRole("heading", {
            name: en ? "Today / Review" : "今日 / 审议",
            exact: true,
          }),
        ).toBeVisible();
        await shot("today-1100");
        await page.setViewportSize({ width: 1280, height: 900 });
        await page
          .getByRole("link", { name: en ? "Project" : "项目", exact: true })
          .click();
        await expect(page.locator(".task-list li").first()).toBeVisible();
        await shot("project-1280");
        await page
          .getByRole("button", {
            name: en ? "Research Brief" : "研究简报",
            exact: true,
          })
          .click();
        await expect(
          page.locator(".project-brief-panel dl").first(),
        ).toBeVisible();
        await shot("brief-1280");
        await page.setViewportSize({ width: 1440, height: 900 });
        await page
          .getByRole("link", { name: en ? "Search" : "搜索", exact: true })
          .click();
        await page
          .getByRole("searchbox", {
            name: en ? "Search research" : "搜索研究内容",
            exact: true,
          })
          .fill("Synthetic");
        await expect(page.locator(".task-list li").first()).toBeVisible();
        await shot("search-1440");
        await page.setViewportSize({ width: 1920, height: 900 });
        await page
          .getByRole("link", { name: en ? "Settings" : "设置", exact: true })
          .click();
        await expect(
          page.getByRole("button", {
            name: en ? "Configure assessment service" : "配置评估服务",
            exact: true,
          }),
        ).toBeVisible();
        await shot("settings-1920");
        await page
          .getByRole("button", {
            name: en ? "Configure assessment service" : "配置评估服务",
            exact: true,
          })
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("button", {
            name: en ? "Configure assessment service" : "配置评估服务",
            exact: true,
          }),
        ).toBeFocused();
        await page
          .getByRole("link", { name: en ? "Project" : "项目", exact: true })
          .click();
        await page
          .getByRole("button", { name: en ? "History" : "历史", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: en ? "History" : "历史",
            exact: true,
          }),
        ).toBeVisible();
        await shot("history-1920");
        await page.setViewportSize({ width: 1100, height: 900 });
        await page
          .getByRole("link", {
            name: en ? "Today / Review" : "今日 / 审议",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: en ? "New review" : "新建审议",
            exact: true,
          })
          .click();
        await shot("new-1100");
        await page
          .getByRole("textbox", {
            name: en ? "New suggestion" : "新的建议",
            exact: true,
          })
          .fill(
            en
              ? "Keep the observed association separate from an unproven causal claim."
              : "保留观察到的关联，不把它写成尚未证实的因果结论。",
          );
        await page
          .getByRole("button", {
            name: en ? "Save draft" : "保存草稿",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("textbox", {
            name: en ? "Suggestion" : "建议内容",
            exact: true,
          }),
        ).toBeVisible();
        await page.setViewportSize({ width: 1440, height: 900 });
        await shot("review-1440");
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await page.setViewportSize({ width: 1100, height: 900 });
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => document.activeElement?.tagName),
        ).not.toBe("BODY");
        await shot("review-200-percent-1100");
        expect(outbound).toEqual([]);
      } finally {
        await server.close();
        await fixture.cleanup();
      }
    });
  }
