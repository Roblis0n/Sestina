import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../../apps/research-room/src/language-preferences.js";
import {
  createRi49FixtureProject,
  Ri49IndependentProvider,
  type Ri49FixtureProject,
} from "../../apps/research-room/test/ri49-test-fixture.js";

class MemoryLanguagePreferenceStore implements LanguagePreferenceStore {
  constructor(public language: AppLanguage | undefined) {}
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve(this.language); }
  writeLanguage(language: AppLanguage): Promise<void> { this.language = language; return Promise.resolve(); }
}

interface OpenedRoom {
  readonly server: RunningResearchRoomServer;
  readonly fixture: Ri49FixtureProject;
}

const servers: RunningResearchRoomServer[] = [];
const cleanups: (() => Promise<void>)[] = [];

test.afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function openRoom(page: Page, provider?: Ri49IndependentProvider): Promise<OpenedRoom> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri49-browser-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const fixture = await createRi49FixtureProject(root);
  const server = await createResearchRoomServer({
    ...(provider ? { correctionAppealSecondOpinionProvider: provider } : {}),
    directoryPicker: { pick: () => Promise.resolve(root) },
    languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"),
  }).start();
  servers.push(server);
  await page.goto(server.origin);
  await expect(page.getByRole("status")).toContainText("本地服务已就绪");
  await page.getByRole("button", { name: "选择文件夹并打开" }).click();
  await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
  return { server, fixture };
}

async function objectNav(page: Page, name: string): Promise<void> {
  await page.locator(".object-nav-link").filter({ hasText: name }).click();
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

async function capture(page: Page, testInfo: TestInfo, name: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await expect(page.locator("body")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const output = testInfo.outputPath(name);
  const png = await page.screenshot({ path: output, animations: "disabled" });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(width);
  expect(png.readUInt32BE(20)).toBe(height);
  expect(png.byteLength).toBeGreaterThan(10_000);
  expect(new Set(png).size).toBeGreaterThan(64);
}

async function openReceiptFinding(page: Page, findingKind: string): Promise<void> {
  await objectNav(page, "Receipts");
  await page.locator(".ledger-list li button").first().click();
  const finding = page.locator(".receipt-finding-actions li").filter({ hasText: findingKind });
  await expect(finding).toBeVisible();
  await finding.getByRole("button", { name: "发起 Appeal" }).click();
  await expect(page.getByRole("heading", { name: "申诉一条 finding" })).toBeVisible();
}

async function createAppeal(page: Page, suffix: string): Promise<void> {
  await page.getByLabel("异议摘要").fill(`原 finding 把明确的证据边界误读成了因果主张。${suffix}`);
  await page.getByLabel("主张的错误").fill("被申诉句子是在限制推断能力，不是在宣称因果结果。" + suffix);
  await page.getByLabel("遗漏或误读的上下文").fill("Active Brief 明确禁止从观察性设计推断因果关系；该限制句必须与关联描述一起阅读。" + suffix);
  await page.getByLabel("给独立意见的单一问题").fill("冻结输入中的边界句是否真的构成受申诉 criterion 的正例？" + suffix);
  await page.getByRole("button", { name: "创建 Appeal 草稿" }).click();
  await expect(page.locator(".appeal-workspace")).toContainText("draft");
}

async function recordAppeal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "确认记录" }).click();
  await expect(page.locator(".appeal-workspace")).not.toContainText("CORRECTION APPEAL · v1");
}

test.describe("RI-49 production correction appeal UI", () => {
  test("high contrast: exact Manifest, independent result, deterministic comparison, and user resolution remain vivid and usable", async ({ page }, testInfo) => {
    await openRoom(page, new Ri49IndependentProvider());
    await chooseTheme(page, "zh", "high_contrast");
    await openReceiptFinding(page, "argument_leap");
    await createAppeal(page, "这是一段用于验证长内容换行、滚动与信息层级的安全合成文本。".repeat(5));

    const canvas = await page.evaluate<string>("getComputedStyle(document.body).backgroundColor");
    expect(canvas).toBe("rgb(2, 8, 23)");
    await expect(page.locator(".appeal-provider-state")).not.toContainText("尚未配置独立 Provider");
    const headingBox = await page.locator(".appeal-hero h1").boundingBox();
    expect(headingBox).not.toBeNull();
    expect(headingBox?.height).toBeLessThan(300);
    const reloadBox = await page.getByRole("button", { name: "重新加载" }).boundingBox();
    expect(reloadBox).not.toBeNull();
    expect(reloadBox?.width).toBeGreaterThan(70);
    await page.locator(".appeal-hero").scrollIntoViewIfNeeded();
    await capture(page, testInfo, "ri49-high-contrast-draft-1440x900.png", 1440, 900);

    await recordAppeal(page);
    await page.getByRole("button", { name: "选择上下文" }).click();
    await page.getByRole("button", { name: "生成精确 Manifest — 暂不发送" }).click();
    const manifest = page.locator(".manifest-confirmation");
    await expect(manifest).toContainText("original_finding_verdict");
    await expect(manifest).toContainText("尚未发送");
    await expect(manifest).not.toContainText("ri49-original-model");
    await manifest.scrollIntoViewIfNeeded();
    await capture(page, testInfo, "ri49-high-contrast-manifest-1440x900.png", 1440, 900);

    await page.getByLabel(/我已核对精确的包含与排除内容/u).check();
    await page.getByRole("button", { name: "确认并发送一次" }).click();
    const comparison = page.locator(".appeal-comparison");
    await expect(comparison).toContainText("direct_contradiction");
    const relationBox = await comparison.getByText("direct_contradiction", { exact: true }).boundingBox();
    expect(relationBox).not.toBeNull();
    expect(relationBox?.height).toBeLessThan(48);
    await comparison.scrollIntoViewIfNeeded();
    await capture(page, testInfo, "ri49-high-contrast-comparison-1728x1000.png", 1728, 1000);

    const resolution = page.locator(".resolution-gate");
    await resolution.getByRole("combobox", { name: "裁决", exact: true }).selectOption("overturn_original_finding");
    await resolution.getByLabel("公开理由").fill("研究所有者核对冻结来源、独立意见及确定性比较后，裁定原 finding 不成立。模型没有替用户作决定。");
    await resolution.getByLabel(/我以研究所有者身份裁决/u).check();
    await resolution.getByRole("button", { name: "确认用户裁决" }).click();
    await expect(page.locator(".resolution-gate.resolved")).toContainText("overturn_original_finding");
    await page.reload();
    await expect(page.locator(".resolution-gate.resolved")).toContainText("用户裁决 Receipt");
    await page.locator(".resolution-gate.resolved").scrollIntoViewIfNeeded();
    await capture(page, testInfo, "ri49-high-contrast-resolved-1440x900.png", 1440, 900);
  });

  test("record-only path stays complete in English at a narrow desktop viewport", async ({ page }, testInfo) => {
    await openRoom(page);
    await openReceiptFinding(page, "argument_leap");
    await createAppeal(page, " record-only synthetic boundary");
    await recordAppeal(page);
    await expect(page.locator(".appeal-workspace")).toContainText("appeal_record_only");

    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.locator(".authority-ribbon")).toContainText("User authority is final");
    await chooseTheme(page, "en", "light");
    const resolution = page.locator(".resolution-gate");
    await resolution.scrollIntoViewIfNeeded();
    await capture(page, testInfo, "ri49-light-record-only-en-1100x760.png", 1100, 760);

    await resolution.getByRole("combobox", { name: "Resolution", exact: true }).selectOption("record_disagreement_without_resolution");
    await resolution.getByLabel("Public reason").fill("The owner preserves the disagreement without pretending an independent opinion exists.");
    await resolution.getByLabel(/I am resolving this appeal as the research owner/u).check();
    await resolution.getByRole("button", { name: "Confirm user resolution" }).click();
    await expect(page.locator(".resolution-gate.resolved")).toContainText("record_disagreement_without_resolution");
  });

  test("provider failure and cancellation remain recoverable without partial authority", async ({ page }, testInfo) => {
    await openRoom(page, new Ri49IndependentProvider(0, "failure"));
    await chooseTheme(page, "zh", "dark");
    await openReceiptFinding(page, "argument_leap");
    await createAppeal(page, " 失败路径安全合成文本");
    await recordAppeal(page);
    await page.getByRole("button", { name: "选择上下文" }).click();
    await page.getByRole("button", { name: "生成精确 Manifest — 暂不发送" }).click();
    await page.getByLabel(/我已核对精确的包含与排除内容/u).check();
    await page.getByRole("button", { name: "确认并发送一次" }).click();
    await expect(page.locator(".appeal-workspace")).toContainText("provider_failed");
    await expect(page.locator(".resolution-gate")).toBeVisible();
    await page.locator(".appeal-hero").scrollIntoViewIfNeeded();
    await capture(page, testInfo, "ri49-dark-provider-failure-top-1280x800.png", 1280, 800);
    await page.locator(".appeal-running, .attempt-list").last().scrollIntoViewIfNeeded();
    await capture(page, testInfo, "ri49-dark-provider-failure-retry-1280x800.png", 1280, 800);

    await servers.pop()?.close();
    const root = await mkdtemp(join(tmpdir(), "sestina-ri49-browser-cancel-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await createRi49FixtureProject(root);
    const cancellable = await createResearchRoomServer({
      correctionAppealSecondOpinionProvider: new Ri49IndependentProvider(30_000),
      directoryPicker: { pick: () => Promise.resolve(root) },
      languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"),
    }).start();
    servers.push(cancellable);
    await page.goto(cancellable.origin);
    await page.getByRole("button", { name: "选择文件夹并打开" }).click();
    await openReceiptFinding(page, "argument_leap");
    await createAppeal(page, " 取消路径安全合成文本");
    await recordAppeal(page);
    await page.getByRole("button", { name: "选择上下文" }).click();
    await page.getByRole("button", { name: "生成精确 Manifest — 暂不发送" }).click();
    await page.getByLabel(/我已核对精确的包含与排除内容/u).check();
    await page.getByRole("button", { name: "确认并发送一次" }).click();
    await expect(page.getByRole("button", { name: "取消尝试" })).toBeVisible();
    await page.getByRole("button", { name: "取消尝试" }).click();
    await expect(page.locator(".appeal-workspace")).toContainText("cancelled");
    await expect(page.locator(".appeal-comparison")).toHaveCount(0);
    await expect(page.locator(".resolution-gate")).toBeVisible();
  });

  test("a slow Windows folder window never freezes language, appearance, cancellation, or manual entry", async ({ page }, testInfo) => {
    const server = await createResearchRoomServer({
      directoryPicker: {
        pick: (signal) => new Promise<undefined>((_resolve, reject) => {
          signal.addEventListener("abort", () => { reject(new Error("cancelled")); }, { once: true });
        }),
      },
      languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"),
    }).start();
    servers.push(server);
    await page.goto(server.origin);

    await page.getByRole("button", { name: "选择文件夹并打开" }).click();
    await expect(page.getByRole("button", { name: "取消文件夹窗口" })).toBeVisible();
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Open a research project" })).toBeVisible();
    await chooseTheme(page, "en", "high_contrast");
    await page.getByText("Enter an absolute path manually", { exact: true }).click();
    await expect(page.getByLabel("Project absolute path")).toBeEnabled();
    await capture(page, testInfo, "ri49-high-contrast-picker-pending-responsive-1280x800.png", 1280, 800);
    await page.getByRole("button", { name: "Cancel folder window" }).click();
    await expect(page.getByRole("button", { name: "Cancel folder window" })).toBeHidden();
    await expect(page.getByRole("status")).toContainText("cancelled");
  });
});
