import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../../apps/research-room/src/language-preferences.js";
import {
  createRi50FixtureProject,
  createRi50ParticipantPair,
  type Ri50FixtureProject,
  type Ri50ProviderMode,
} from "../../apps/research-room/test/ri50-test-fixture.js";

class MemoryLanguagePreferenceStore implements LanguagePreferenceStore {
  constructor(public language: AppLanguage | undefined) {}
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve(this.language); }
  writeLanguage(language: AppLanguage): Promise<void> { this.language = language; return Promise.resolve(); }
}

interface OpenedRoom {
  readonly server: RunningResearchRoomServer;
  readonly fixture: Ri50FixtureProject;
}

const servers: RunningResearchRoomServer[] = [];
const cleanups: (() => Promise<void>)[] = [];

test.afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function openIssue(page: Page, options: { readonly modeA?: Ri50ProviderMode; readonly modeB?: Ri50ProviderMode; readonly delayA?: number; readonly delayB?: number } = {}): Promise<OpenedRoom> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri50-browser-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const fixture = await createRi50FixtureProject(root);
  const pair = createRi50ParticipantPair(options);
  const server = await createResearchRoomServer({
    deliberationParticipantProviders: pair.providers,
    directoryPicker: { pick: () => Promise.resolve(root) },
    languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"),
  }).start();
  servers.push(server);
  await page.goto(server.origin);
  await expect(page.getByRole("status")).toContainText("本地服务已就绪");
  await page.getByRole("button", { name: "选择文件夹并打开" }).click();
  await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
  await page.locator(".object-nav-link").filter({ hasText: "Issues" }).click();
  await page.locator(".ledger-list li button").first().click();
  await expect(page.getByRole("heading", { name: "这个开放 Issue 可以进入有限会商" })).toBeVisible();
  return { server, fixture };
}

async function createDraft(page: Page, longContent = false): Promise<void> {
  await page.getByRole("button", { name: "发起会商室" }).click();
  await expect(page.getByRole("heading", { name: "创建有限轮次会商室" })).toBeVisible();
  if (longContent) {
    await page.getByLabel("会商标题").fill(`观察性关联的有限解释与证据边界复核 ${"长内容换行验证 ".repeat(8)}`);
    await page.getByLabel("冻结问题").fill(`现有冻结证据是否只支持报告有限关联，而不支持因果解释？${"请同时说明替代解释、未知项与下一项区分性证据。".repeat(8)}`);
  }
  await page.getByRole("button", { name: "创建持久草稿" }).click();
  await expect(page.locator(".deliberation-workspace")).toBeVisible();
  await expect(page.locator(".deliberation-protocol-bar")).toContainText("0 / 4");
}

async function prepareInitial(page: Page, fixture: Ri50FixtureProject): Promise<void> {
  await page.getByLabel("精确来源 revision ID").fill(fixture.revisionId);
  await page.getByRole("button", { name: "生成两份精确 Manifest" }).click();
  await expect(page.locator(".manifest-pair .manifest-card")).toHaveCount(2);
  await expect(page.locator(".manifest-stage")).toContainText("未发送");
  await expect(page.locator(".manifest-stage")).not.toContainText("requestBody");
}

async function chooseTheme(page: Page, language: "zh" | "en", theme: "light" | "dark" | "high_contrast"): Promise<void> {
  const labels = language === "zh"
    ? { appearance: "外观", light: "浅色", dark: "深色", high_contrast: "高对比", apply: "应用外观" }
    : { appearance: "Appearance", light: "Light", dark: "Dark", high_contrast: "High contrast", apply: "Apply appearance" };
  await page.getByRole("button", { name: labels.appearance }).click();
  await page.getByRole("radio", { name: labels[theme] }).check();
  await page.getByRole("button", { name: labels.apply }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
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

async function expectStickyLayersDoNotOverlap(page: Page): Promise<void> {
  const chrome = await page.locator(".app-chrome").boundingBox();
  const context = await page.locator(".project-context-bar").boundingBox();
  expect(chrome).not.toBeNull();
  expect(context).not.toBeNull();
  if (chrome === null || context === null) throw new Error("production shell geometry is unavailable");
  if (context.y + context.height <= 0) return;
  expect(Math.round(context.y)).toBeGreaterThanOrEqual(Math.max(0, Math.round(chrome.y + chrome.height)) - 1);
}

async function expectFocusBelowStickySearch(page: Page, focus: Locator): Promise<void> {
  const chrome = await page.locator(".app-chrome").boundingBox();
  const target = await focus.boundingBox();
  const viewport = page.viewportSize();
  expect(chrome).not.toBeNull();
  expect(target).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (chrome === null || target === null || viewport === null) throw new Error("visual target geometry is unavailable");
  const stickyBottom = await getStickyChromeBottom(page);
  expect(Math.round(target.y)).toBeGreaterThanOrEqual(Math.round(stickyBottom) - 1);
  expect(Math.round(target.y)).toBeLessThan(viewport.height);
}

async function positionFocusBelowStickySearch(page: Page, focus: Locator): Promise<void> {
  await focus.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = await focus.boundingBox();
    const viewport = page.viewportSize();
    if (target === null || viewport === null) throw new Error("visual target geometry is unavailable");
    const stickyBottom = await getStickyChromeBottom(page);
    const desiredY = stickyBottom + 16;
    if (target.y >= desiredY - 1 && target.y < viewport.height) return;
    await page.mouse.wheel(0, target.y - desiredY);
    await page.waitForTimeout(50);
  }
}

async function getStickyChromeBottom(page: Page): Promise<number> {
  return page.evaluate<number>(`(() => {
    const element = document.querySelector(".app-chrome");
    if (!element) return 0;
    return getComputedStyle(element).position === "sticky"
      ? Math.max(0, element.getBoundingClientRect().bottom)
      : 0;
  })()`);
}

async function capture(page: Page, testInfo: TestInfo, name: string, width: number, height: number, focus?: Locator): Promise<void> {
  await page.setViewportSize({ width, height });
  if (focus) {
    await positionFocusBelowStickySearch(page, focus);
    await expectFocusBelowStickySearch(page, focus);
  }
  await expect(page.locator("body")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const output = testInfo.outputPath(name);
  const png = await page.screenshot({ path: output, animations: "disabled" });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(width);
  expect(png.readUInt32BE(20)).toBe(height);
  expect(png.byteLength).toBeGreaterThan(12_000);
  expect(new Set(png).size).toBeGreaterThan(64);
}

test.describe("RI-50 production mutually blind Deliberation Room UI", () => {
  test("runs the complete bounded protocol from an Issue through explicit user Resolution", async ({ page }, testInfo) => {
    const { fixture } = await openIssue(page, { delayA: 1_400, delayB: 1_400 });
    await page.setViewportSize({ width: 1920, height: 1080 });
    const backButtonBox = await page.getByRole("button", { name: "返回列表" }).boundingBox();
    expect(backButtonBox).not.toBeNull();
    if (backButtonBox === null) throw new Error("Issue entry action geometry is unavailable");
    expect(Math.round(backButtonBox.width)).toBeGreaterThanOrEqual(72);
    expect(Math.round(backButtonBox.height)).toBeLessThanOrEqual(64);
    await capture(page, testInfo, "01-ri50-light-zh-issue-entry-1920x1080.png", 1920, 1080, page.locator(".deliberation-entry"));

    await createDraft(page);
    await capture(page, testInfo, "02-ri50-light-zh-room-draft-1440x900.png", 1440, 900, page.locator(".deliberation-room-header"));
    await prepareInitial(page, fixture);
    await capture(page, testInfo, "03-ri50-light-zh-manifest-pair-1440x900.png", 1440, 900, page.locator(".manifest-stage"));
    await page.getByLabel("我已检查两份 Manifest，并明确授权这些有限发送。").check();

    await chooseTheme(page, "zh", "dark");
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await page.getByRole("button", { name: "Start blind initial round" }).click();
    await expect(page.getByRole("heading", { name: "Mutually blind initial round" })).toBeVisible();
    await expect(page.locator(".running-stage")).not.toContainText("Retain the observational association");
    await expect(page.locator(".resolution-stage, .close-room-stage")).toHaveCount(0);
    await capture(page, testInfo, "04-ri50-dark-en-blind-running-1280x800.png", 1280, 800, page.locator(".running-stage"));

    await expect(page.getByRole("heading", { name: "Terminal results are sealed" })).toBeVisible();
    await expect(page.locator(".deliberation-workspace")).not.toContainText("Retain the observational association only");
    await capture(page, testInfo, "05-ri50-dark-en-terminal-sealed-1280x800.png", 1280, 800, page.locator(".reveal-stage"));
    await page.getByRole("button", { name: "Reveal both assessments" }).click();
    await expect(page.getByRole("heading", { name: "Difference Summary first" })).toBeVisible();
    await expect(page.locator(".difference-safety")).toContainText("winner: none");

    await chooseTheme(page, "en", "high_contrast");
    expect(await page.evaluate<string>("getComputedStyle(document.body).backgroundColor")).toBe("rgb(2, 8, 23)");
    await capture(page, testInfo, "06-ri50-high-contrast-en-difference-1728x1000.png", 1728, 1000, page.locator(".difference-stage"));
    await page.getByRole("button", { name: "Prepare two challenge Manifests" }).click();
    await expect(page.getByRole("heading", { name: "Directed challenge Manifests" })).toBeVisible();
    await capture(page, testInfo, "07-ri50-high-contrast-en-challenge-manifests-1440x900.png", 1440, 900, page.locator(".manifest-stage"));
    await page.getByLabel("I inspected both Manifests and explicitly authorize these bounded sends.").check();
    await page.getByRole("button", { name: "Start one directed challenge" }).click();
    await expect(page.getByRole("heading", { name: "Directed challenge running" })).toBeVisible();
    await expect(page.locator(".resolution-stage, .close-room-stage")).toHaveCount(0);
    await capture(page, testInfo, "08-ri50-high-contrast-en-challenge-running-1280x800.png", 1280, 800, page.locator(".running-stage"));

    await expect(page.getByRole("heading", { name: "Your Resolution" })).toBeVisible();
    await expect(page.locator(".deliberation-protocol-bar")).toContainText("4 / 4");
    await capture(page, testInfo, "09-ri50-high-contrast-en-resolution-gate-1440x900.png", 1440, 900, page.locator(".resolution-stage"));
    await page.locator('.resolution-choice-grid input[value="keep_disputed"]').check();
    await page.getByLabel("Public reason").fill("The research owner preserves the bounded disagreement until discriminating evidence is available; no model selected a winner.");
    await page.getByRole("button", { name: "Append my Resolution" }).click();
    await expect(page.locator(".deliberation-workspace")).toContainText("resolved");
    await page.locator(".deliberation-trace details").last().locator("summary").click();
    await expect(page.locator(".deliberation-trace details").last()).toContainText('"canonicalMutationAuthorized": false');
    await page.reload();
    await page.locator(".deliberation-trace details").last().locator("summary").click();
    await expect(page.locator(".deliberation-trace details").last()).toContainText('"separateAuthorityRequired": true');
    await chooseTheme(page, "en", "light");
    await capture(page, testInfo, "10-ri50-light-en-resolved-reload-1440x900.png", 1440, 900, page.locator(".deliberation-trace details").last());
  });

  test("shows a vivid partial failure and records a long manual opinion without calling it blind", async ({ page }, testInfo) => {
    const { fixture } = await openIssue(page, { modeB: "failure" });
    await createDraft(page, true);
    await chooseTheme(page, "zh", "high_contrast");
    await prepareInitial(page, fixture);
    await page.getByLabel("我已检查两份 Manifest，并明确授权这些有限发送。").check();
    await page.getByRole("button", { name: "启动互盲首轮" }).click();
    await expect(page.getByRole("heading", { name: "终态结果仍处于封存状态" })).toBeVisible();
    await page.getByRole("button", { name: "查看合法 partial 结果" }).click();
    await expect(page.getByRole("heading", { name: "Partial——并非完成的会商" })).toBeVisible();
    await expect(page.locator(".difference-stage")).toContainText("不是完整双参与者比较");
    await capture(page, testInfo, "11-ri50-high-contrast-zh-partial-1100x760.png", 1100, 760, page.locator(".failure-stage"));

    await page.getByRole("button", { name: "添加意见" }).click();
    await page.getByLabel("来源描述").fill("用户粘贴的公开外部意见");
    await page.getByLabel("声明的 Provider").fill("外部 Provider 声明，未经 Sestina 验证");
    await page.getByLabel("声明的模型").fill("外部模型声明，未经 Sestina 验证");
    await page.getByLabel("用户声明的上下文范围").fill(`该意见看过冻结问题与参与者 A 的公开输出，但没有可验证的 session 隔离。${"上下文暴露说明。".repeat(12)}`);
    await page.getByLabel("该意见看过参与者 A 输出").check();
    await page.getByLabel("公开意见").fill(`仅保留有限关联，并等待区分性设计证据。${"这是一段安全合成长文本，用于验证换行、信息层级和桌面滚动。".repeat(14)}`);
    await capture(page, testInfo, "12-ri50-high-contrast-zh-manual-opinion-form-1280x800.png", 1280, 800, page.locator(".manual-opinion-stage"));
    await page.getByRole("button", { name: "追加手工意见" }).click();
    await expect(page.locator(".manual-opinion-list")).toContainText("manual_non_blind");
    await expect(page.locator(".manual-opinion-list")).toContainText("not_verifiable");
    await expect(page.locator(".manual-opinion-form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "添加意见" })).toBeVisible();
    await capture(page, testInfo, "13-ri50-high-contrast-zh-manual-opinion-recorded-1280x800.png", 1280, 800, page.locator(".manual-opinion-stage"));

    await chooseTheme(page, "zh", "light");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate('document.documentElement.style.setProperty("font-size", "200%", "important")');
    expect(await page.evaluate("getComputedStyle(document.documentElement).fontSize")).toBe("32px");
    const motion = await page.evaluate<string>('getComputedStyle(document.querySelector(".status-badge")).animationDuration');
    expect(["0s", "0.001s"]).toContain(motion);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".difference-stage").scrollIntoViewIfNeeded();
    await expectStickyLayersDoNotOverlap(page);
    await capture(page, testInfo, "14-ri50-light-zh-200-percent-reduced-motion-1440x900.png", 1440, 900, page.locator(".difference-stage"));
  });

  test("cancels two hanging Providers without exposing a partial answer or freezing the interface", async ({ page }, testInfo) => {
    const { fixture } = await openIssue(page, { modeA: "hang", modeB: "hang" });
    await createDraft(page);
    await chooseTheme(page, "zh", "dark");
    await prepareInitial(page, fixture);
    await page.getByLabel("我已检查两份 Manifest，并明确授权这些有限发送。").check();
    await page.getByRole("button", { name: "启动互盲首轮" }).click();
    await expect(page.getByRole("heading", { name: "互盲首轮运行中" })).toBeVisible();
    await expect(page.locator(".resolution-stage, .close-room-stage")).toHaveCount(0);
    await capture(page, testInfo, "15-ri50-dark-zh-cancellable-running-1280x800.png", 1280, 800, page.locator(".running-stage"));
    await page.getByRole("button", { name: "取消有限运行" }).click();
    await expect(page.getByRole("heading", { name: "运行已取消" })).toBeVisible();
    await expect(page.locator(".difference-stage")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "记录用户 Resolution" })).toBeEnabled();
    await chooseTheme(page, "zh", "high_contrast");
    await capture(page, testInfo, "16-ri50-high-contrast-zh-cancelled-1280x800.png", 1280, 800, page.locator(".failure-stage"));
  });
});
