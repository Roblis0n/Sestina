import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../../apps/research-room/src/language-preferences.js";
import { createUi02Project, type Ui02ProjectFixture } from "../helpers/ui02-project.js";

class MemoryLanguagePreferenceStore implements LanguagePreferenceStore {
  constructor(public language: AppLanguage | undefined) {}
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve(this.language); }
  writeLanguage(language: AppLanguage): Promise<void> { this.language = language; return Promise.resolve(); }
}

const servers: RunningResearchRoomServer[] = [];
const cleanups: (() => Promise<void>)[] = [];

test.afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function startRoom(page: Page): Promise<Ui02ProjectFixture> {
  const fixture = await createUi02Project();
  cleanups.push(() => fixture.cleanup());
  const server = await createResearchRoomServer({
    directoryPicker: { pick: () => Promise.resolve(fixture.root) },
    languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"),
  }).start();
  servers.push(server);
  await page.goto(server.origin);
  await expect(page.getByRole("status")).toContainText("本地服务已就绪");
  await page.getByRole("button", { name: "选择文件夹并打开" }).click();
  await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
  return fixture;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate<readonly { readonly tag: string; readonly className: string; readonly left: number; readonly right: number }[]>(`[...document.querySelectorAll("body *")].filter((element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") return false;
    const rect = element.getBoundingClientRect();
    return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1;
  }).map((element) => ({ tag: element.tagName, className: String(element.className), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right) })).slice(0, 20)`);
  expect(overflow).toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, name: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await expectNoHorizontalOverflow(page);
  const output = testInfo.outputPath(name);
  const png = await page.screenshot({ path: output, animations: "disabled", fullPage: true });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.byteLength).toBeGreaterThan(10_000);
}

test.describe("UI-03 production experience cohesion", () => {
  test("keeps the active research line visible while Search stays an on-demand entry", async ({ page }) => {
    const fixture = await startRoom(page);

    const researchLine = page.getByRole("region", { name: "当前研究线" });
    await expect(researchLine).toContainText(fixture.question);
    await expect(researchLine).toContainText(fixture.originalTask);
    await expect(researchLine).toContainText("ledger_only");

    const searchTrigger = page.getByRole("button", { name: "搜索项目内容" });
    await expect(searchTrigger).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "项目内搜索" })).toHaveCount(0);
    await searchTrigger.click();
    const searchbox = page.getByRole("searchbox", { name: "项目内搜索" });
    await expect(searchbox).toBeFocused();
    await searchbox.fill("canonical evidence");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByRole("region", { name: "搜索结果" })).toContainText(/canonical evidence/iu);
    await page.keyboard.press("Escape");
    await expect(searchbox).toHaveCount(0);
    await expect(searchTrigger).toBeFocused();

    await page.locator(".object-nav-link").filter({ hasText: "Decisions" }).click();
    await page.locator(".ledger-list li button").first().click();
    await expect(page.getByRole("region", { name: "当前研究线" })).toContainText(fixture.originalTask);
    await expect(page.locator(".workspace-header")).toHaveCount(1);
  });

  test("explains degraded authority actions and restores Inspector focus", async ({ page }) => {
    await startRoom(page);
    await page.getByRole("button", { name: /Review Room/u }).click();

    const boundary = page.getByRole("region", { name: "运行边界与下一步" });
    await expect(boundary).toContainText("ledger_only");
    await expect(boundary).toContainText("Provider");
    await expect(boundary).toContainText("拒绝");

    await page.getByLabel("单个建议").fill("Preserve the bounded research question and disclose every unknown.");
    await page.getByLabel("证据类别").selectOption("synthetic_fixture");
    await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
    const inspectorTrigger = page.getByRole("button", { name: "检查 Context Manifest" });
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(inspectorTrigger).toBeFocused();

    await page.getByRole("button", { name: "我已核对，开始分析" }).click();
    await page.keyboard.press("Escape");
    const accept = page.getByRole("button", { name: "接受", exact: true });
    await expect(accept).toBeDisabled();
    await expect(page.getByRole("note", { name: "为什么这些操作不可用" })).toContainText("semantic_ready");
  });

  test("remains operable at narrow desktop, 200 percent text, themes, languages, and reduced preferences", async ({ page }, testInfo) => {
    await startRoom(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    expect(await page.evaluate<string>(`getComputedStyle(document.querySelector(".project-shell")).transitionDuration`)).toBe("0s");
    await page.evaluate('document.documentElement.style.setProperty("font-size", "200%", "important")');
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("region", { name: "当前研究线" })).toBeVisible();
    await capture(page, testInfo, "ui03-light-zh-review-200pct-1100x800.png", 1100, 800);

    await page.evaluate('document.documentElement.style.removeProperty("font-size")');
    await expect.poll(async () => Math.round((await page.locator(".app-chrome").boundingBox())?.height ?? 999)).toBeLessThan(180);
    await expect(page.locator("html")).toHaveAttribute("data-chrome-layout", "sticky");
    await page.getByRole("button", { name: "外观" }).click();
    await expect(page.getByRole("group", { name: "主题" }).getByRole("radio", { name: "跟随系统" })).toBeFocused();
    await page.getByRole("radio", { name: "高对比" }).check();
    await page.getByRole("group", { name: "减少动态" }).getByRole("radio", { name: "开启" }).check();
    await page.getByRole("checkbox", { name: "减少透明" }).check();
    await page.getByRole("button", { name: "应用外观" }).click();
    await expect(page.getByRole("button", { name: "外观" })).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "high_contrast");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("region", { name: "Current research line" })).toBeVisible();
    const activeBorder = await page.evaluate<number>(`parseFloat(getComputedStyle(document.querySelector('.room-link[data-active="true"]')).borderTopWidth)`);
    const inactiveBorder = await page.evaluate<number>(`parseFloat(getComputedStyle(document.querySelector('.room-link[data-active="false"]')).borderTopWidth)`);
    expect(activeBorder).toBeGreaterThan(inactiveBorder);
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "ui03-high-contrast-en-review-1100x800.png", 1100, 800);
  });
});
