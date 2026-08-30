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

async function openProject(page: Page, options: Parameters<typeof createUi02Project>[0] = {}): Promise<Ui02ProjectFixture> {
  const fixture = await createUi02Project(options);
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

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = true): Promise<void> {
  await expectNoHorizontalOverflow(page);
  const png = await page.screenshot({ path: testInfo.outputPath(name), animations: "disabled", fullPage });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.byteLength).toBeGreaterThan(10_000);
}

test.describe("UI-04 production interface craft", () => {
  test("keeps the next Review action in the first viewport and preserves an inspectable three-pane source", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await openProject(page, {
      title: "UI-04 Production Coherence Workspace",
      question: "How should a local research instrument preserve a long, evidence-bounded question while keeping the current object, authority, source, and next safe action legible at once?",
      evidenceSummary: "A deliberately long canonical source summary used to verify sustained reading, provenance visibility, and Inspector wrapping without substituting fixture behavior for real Provider evidence.",
    });
    await page.getByRole("button", { name: /Review Room/u }).click();
    await page.getByLabel("单个建议").fill("Preserve the active research line, expose the exact outbound Context Manifest, and keep every disposition behind explicit user authority.");
    await page.getByLabel("证据类别").selectOption("synthetic_fixture");
    await page.getByRole("button", { name: "先生成 Context Manifest" }).click();

    const inspector = page.getByRole("complementary", { name: "Context Inspector" });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("Manifest hash");
    await page.evaluate("window.scrollTo(0, 0)");
    await capture(page, testInfo, "ui04-after-review-manifest-zh-light-1440x900.png");

    await page.keyboard.press("Escape");
    await page.evaluate("window.scrollTo(0, 0)");
    const primaryAction = page.getByRole("button", { name: "我已核对，开始分析" });
    await expect(primaryAction).toBeFocused();
    await expect(primaryAction).toBeVisible();
    const box = await primaryAction.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 901) + (box?.height ?? 0), "the next safe action must remain in the first production viewport").toBeLessThanOrEqual(884);
    await expect(page.getByRole("region", { name: "当前研究线" })).toContainText(fixture.question);
  });

  test("completes one authority-bearing object command, Review disposition, Receipt reload, and managed recovery", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await openProject(page, {
      title: "UI-04 Core Journey",
      question: "Which bounded interface choices keep evidence, proposal, Provider provenance, and user authority causally legible across a complete local research journey?",
    });

    await page.locator(".object-nav-link").filter({ hasText: "Issues" }).click();
    await page.getByRole("button", { name: /Resolve the evidence boundary/u }).click();
    const resolve = page.locator(".command-accordions details").filter({ hasText: "解决" });
    await resolve.locator("summary").click();
    await resolve.getByLabel("Canonical Evidence ID（规范证据 ID）").fill(fixture.evidenceId);
    await resolve.getByLabel("理由", { exact: true }).fill("Bind this resolution to the current canonical Evidence and preserve the recorded causal trace.");
    await resolve.getByRole("button", { name: "解决", exact: true }).click();
    await expect(page.locator(".object-workspace > .status-badge, .workspace-header .status-badge").first()).toContainText("resolved");

    await page.getByRole("button", { name: /Review Room/u }).click();
    await page.getByLabel("单个建议").fill("Keep the resolved Evidence boundary visible and reject any inference that exceeds the local ledger-only evidence class.");
    await page.getByLabel("证据类别").selectOption("synthetic_fixture");
    await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toContainText("当前未发送");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "我已核对，开始分析" }).click();
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toContainText("ledger_only");
    await page.keyboard.press("Escape");
    const dispositionAction = page.getByRole("button", { name: "核对并记录处置" });
    await expect(dispositionAction).toBeFocused();
    await dispositionAction.click();
    await expect(page.getByLabel("你的处置理由")).toBeFocused();
    await page.getByLabel("你的处置理由").fill("Reject the proposal because ledger-only mode cannot support the requested semantic inference.");
    await page.getByRole("button", { name: "拒绝", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("处置已提交并生成凭证");
    await expect(page.locator(".receipt-list li")).toHaveCount(1);
    await capture(page, testInfo, "ui04-core-journey-committed-zh-light-1440x900.png", false);

    await page.getByRole("button", { name: "打开 Trace" }).click();
    await expect(page.getByRole("heading", { name: "用户可读因果 Trace" })).toBeVisible();
    const tracePath = new URL(page.url()).pathname;
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${tracePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"));
    await expect(page.getByRole("heading", { name: "用户可读因果 Trace" })).toBeVisible();

    await page.getByRole("button", { name: "备份与恢复" }).click();
    const recovery = page.getByRole("dialog", { name: "备份与恢复" });
    await expect(recovery).toContainText("healthy");
    await recovery.getByRole("button", { name: "创建已验证备份" }).click();
    await expect(recovery.locator(".recovery-backups li")).toHaveCount(1);
    await recovery.getByRole("button", { name: "预览恢复" }).click();
    await recovery.getByRole("checkbox").check();
    await capture(page, testInfo, "ui04-core-journey-recovery-confirmation-zh-light-1440x900.png", false);
    await recovery.getByRole("button", { name: "恢复并重新打开" }).click();
    await expect(recovery).toContainText("已恢复并重新打开");
    await recovery.getByRole("button", { name: "返回 Research Room" }).click();
    await expect(page.getByRole("region", { name: "当前研究线" })).toContainText(fixture.question);
  });

  test("keeps long research content coherent across desktop widths, themes, languages, reduced preferences, and Inspector", async ({ page }, testInfo) => {
    await openProject(page, {
      title: "UI-04 Long Reading and Provenance Matrix",
      question: "When an unusually long research question carries several explicit evidence boundaries, how can the interface keep the active object, source, current status, user-only authority, and next safe action continuously understandable without turning the Research Room into a dashboard or empty chat?",
      evidenceSummary: "This deliberately extended canonical Evidence summary names its local source, descriptive inference capacity, project-private context, and bounded provenance so that narrow desktop layouts must wrap it as readable research content rather than truncate or hide the authority-bearing meaning.",
    });
    await page.getByRole("button", { name: "关闭通知" }).click();

    await page.setViewportSize({ width: 1100, height: 800 });
    await page.evaluate('document.documentElement.style.setProperty("font-size", "200%", "important")');
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("region", { name: "当前研究线" })).toBeVisible();
    await capture(page, testInfo, "ui04-after-light-zh-200pct-1100x800.png");

    await page.evaluate('document.documentElement.style.removeProperty("font-size")');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "项目概览" }).click();
    await expect(page.getByRole("heading", { name: "项目概览" })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开 Pilot" })).toBeVisible();
    await expect(page.locator(".pilot-entry")).toHaveCount(0);
    await expect(page.locator("img.sestina-logo--chrome")).toHaveAttribute("src", "/sestina-logo.png");
    await capture(page, testInfo, "ui04-after-overview-light-zh-1280x800.png");

    await page.getByRole("button", { name: "外观" }).click();
    await page.getByRole("radio", { name: "深色" }).check();
    await page.getByRole("button", { name: "应用外观" }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await capture(page, testInfo, "ui04-after-overview-dark-zh-1440x900.png");

    await page.getByRole("button", { name: "外观" }).click();
    await page.getByRole("radio", { name: "高对比" }).check();
    await page.getByRole("group", { name: "减少动态" }).getByRole("radio", { name: "开启" }).check();
    await page.getByRole("checkbox", { name: "减少透明" }).check();
    await page.getByRole("button", { name: "应用外观" }).click();
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "high_contrast");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await page.locator(".object-nav-link").filter({ hasText: "Evidence" }).click();
    await page.locator(".ledger-list li button").first().click();
    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    const inspector = page.getByRole("complementary", { name: "Context Inspector" });
    await expect(inspector).toContainText("Authority");
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "ui04-after-evidence-high-contrast-en-1920x1080.png");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Inspect", exact: true })).toBeFocused();
  });
});
