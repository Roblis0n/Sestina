import { test, expect } from "@playwright/test";
import { createResearchRoomServer } from "../../../apps/research-room/dist/server.js";
import { productionUiProject } from "../ui-factory.js";

for (const language of ["en", "zh-CN"] as const) for (const theme of ["light", "dark", "high_contrast"] as const) {
  test(`P1-06 G7/G9: primary navigation exposes four user tasks (${language}, ${theme}, 200% text)`, async ({ page }, info) => {
    const fixture = await productionUiProject(theme === "high_contrast" ? "long" : "ready");
    const server = await createResearchRoomServer({ directoryPicker: { pick: async () => fixture.root }, languagePreferenceStore: { readLanguage: async () => language, writeLanguage: async () => {} } }).start();
    try {
      const outbound: string[] = [];
      await page.route("**/*", async route => { const url = new URL(route.request().url()); if (url.origin !== server.origin) { outbound.push(url.origin); await route.abort(); } else await route.continue(); });
      await page.addInitScript(({ theme }) => localStorage.setItem("sestina.app.appearance.v1", JSON.stringify({ version: 1, theme, reducedMotion: "on", reducedTransparency: true })), { theme });
      await page.goto(server.origin);
      await page.getByRole("button", { name: language === "en" ? "Select a folder and open" : "选择文件夹并打开" }).click();
      await expect(page.getByRole("heading", { name: "Research Room", exact: true })).toBeVisible();
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
      await page.screenshot({ path: info.outputPath("production-navigation.png"), fullPage: true });
      expect(outbound).toEqual([]);
      const entries = await page.locator(".project-navigation nav .room-link").allTextContents();
      expect(entries.map(s => s.trim())).toHaveLength(4);
    } finally { await server.close(); await fixture.cleanup(); }
  });
}
test("P1-04 G6/G9: the built Brief editor offers typed controls instead of editable JSON", async ({ page }, info) => {
  const fixture = await productionUiProject("ready"); const server = await createResearchRoomServer({ directoryPicker: { pick: async () => fixture.root }, languagePreferenceStore: { readLanguage: async () => "en", writeLanguage: async () => {} } }).start();
  try {
    await page.goto(server.origin); await page.getByRole("button", { name: "Select a folder and open" }).click();
    await expect(page.getByRole("heading", { name: "Research Room", exact: true })).toBeVisible();
    await page.locator(".project-navigation button[title='Research Brief']").click();
    await page.getByRole("button", { name: "Create candidate", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Candidate editor" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("production-brief-editor.png"), fullPage: true });
    expect(await page.locator(".structured-editor textarea.code-input:not([readonly])").count()).toBe(0);
  } finally { await server.close(); await fixture.cleanup(); }
});
