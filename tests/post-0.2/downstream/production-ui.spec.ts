import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { productionUiProject } from "../ui-factory.js";
import { migrateKernelProject } from "../../../packages/core/src/index.js";

for (const language of ["en", "zh-CN"] as const)
  for (const theme of ["light", "dark", "high_contrast"] as const) {
    test(`P1-06 G9: primary navigation exposes four user tasks (${language}, ${theme}, 200% text)`, async ({
      page,
    }, info) => {
      const fixture = await productionUiProject(
        theme === "high_contrast" ? "long" : "ready",
      );
      await migrateKernelProject({ projectRoot: fixture.root });
      const server = await createResearchRoomServer({
        directoryPicker: { pick: async () => fixture.root },
        languagePreferenceStore: {
          readLanguage: async () => language,
          writeLanguage: async () => {},
        },
      }).start();
      try {
        const outbound: string[] = [];
        await page.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== server.origin) {
            outbound.push(url.origin);
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
        await page.goto(`${server.origin}/project/today`);
        await page
          .getByRole("textbox", {
            name: language === "en" ? "Project folder" : "项目文件夹",
            exact: true,
          })
          .fill(fixture.root);
        await page
          .getByRole("button", {
            name: language === "en" ? "Open project" : "打开项目",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("heading", {
            name: language === "en" ? "Today / Review" : "今日 / 审议",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText(
            "Inspect one bounded continuity change across the canonical ledgers.",
            { exact: true },
          ),
        ).toBeVisible();
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => document.activeElement?.tagName),
        ).not.toBe("BODY");
        await page.screenshot({
          path: info.outputPath("production-navigation.png"),
          fullPage: true,
        });
        expect(outbound).toEqual([]);
        const entries = await page
          .locator(".kernel-navigation nav .room-link")
          .allTextContents();
        expect(entries.map((s) => s.trim())).toEqual(
          language === "en"
            ? ["Today / Review", "Project", "Search", "Settings"]
            : ["今日 / 审议", "项目", "搜索", "设置"],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      } finally {
        await server.close();
        await fixture.cleanup();
      }
    });
  }
