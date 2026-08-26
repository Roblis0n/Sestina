import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../../apps/research-room/src/language-preferences.js";
import { ProviderConfigurationService, createFileProviderConfigStore } from "../../apps/research-room/src/provider-settings.js";
import type { SecretBackend } from "../../packages/secrets/src/index.js";
import { createRi48Project, Ri48FixtureProvider } from "../helpers/ri48-project.js";

type Scenario = "reasonable-increment" | "target-substitution" | "repeated-audit";
interface ScenarioFixture { readonly suggestion: string; readonly evidenceClass: "synthetic_fixture" | "synthetic_adversarial_fixture"; readonly expected: { readonly findingKind: string } }

class CancellableBrowserProvider extends Ri48FixtureProvider {
  readonly started: Promise<void>;
  private markStarted!: () => void;
  aborted = false;
  constructor() {
    super();
    this.started = new Promise((resolve) => { this.markStarted = resolve; });
  }
  override analyze(_request: Parameters<Ri48FixtureProvider["analyze"]>[0], _preview: unknown, options: { readonly signal: AbortSignal }): Promise<unknown> {
    this.calls += 1;
    this.markStarted();
    return new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => {
      this.aborted = true;
      reject(Object.assign(new Error("provider_aborted"), { code: "provider_aborted" }));
    }, { once: true }); });
  }
}

class FailingBrowserProvider extends Ri48FixtureProvider {
  override analyze(): Promise<unknown> {
    this.calls += 1;
    return Promise.reject(new Error("synthetic_provider_failure"));
  }
}

class MemoryLanguagePreferenceStore implements LanguagePreferenceStore {
  constructor(public language: AppLanguage | undefined) {}
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve(this.language); }
  writeLanguage(language: AppLanguage): Promise<void> { this.language = language; return Promise.resolve(); }
}

const servers: RunningResearchRoomServer[] = [];
const cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => { while (servers.length) await servers.pop()?.close(); while (cleanups.length) await cleanups.pop()?.(); });

async function scenario(name: Scenario): Promise<ScenarioFixture> {
  return JSON.parse(await readFile(resolve(import.meta.dirname, `../fixtures/ri48/${name}.json`), "utf8")) as ScenarioFixture;
}

async function openRoom(page: Page, provider: Ri48FixtureProvider) {
  const fixture = await createRi48Project(); cleanups.push(() => fixture.cleanup());
  const server = await createResearchRoomServer({ provider, directoryPicker: { pick: () => Promise.resolve(fixture.root) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
  await page.goto(server.origin);
  await expect(page.getByRole("status")).toContainText("本地服务已就绪");
  await page.getByRole("button", { name: "选择文件夹并打开" }).click();
  await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
  await expect(page.getByText("How should a synthetic observational association be reported?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "先生成 Context Manifest" })).toBeDisabled();
  await expect(page.locator(".receipt-list")).toContainText("尚无已提交凭证");
  return { fixture, server };
}

async function prepareAndAnalyze(page: Page, fixture: ScenarioFixture, provider: Ri48FixtureProvider, onManifest?: () => Promise<void>) {
  await page.getByLabel("单个建议").fill(fixture.suggestion);
  await page.getByLabel("证据类别").selectOption(fixture.evidenceClass);
  await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
  const inspector = page.getByRole("complementary", { name: "Context Inspector" });
  await expect(inspector.getByRole("heading", { name: "Context Inspector" })).toBeVisible();
  await expect(inspector).toContainText("当前未发送");
  await expect(inspector).toContainText("1.0.0");
  await expect(inspector).toContainText("api_keys");
  expect(provider.calls).toBe(0);
  await onManifest?.();
  await page.getByRole("button", { name: "我已核对，开始分析" }).click();
  await expect(page.locator("#findings")).toContainText(fixture.expected.findingKind);
  await expect(page.getByRole("heading", { name: "Authority Gate — 只有你能处置" })).toBeVisible();
  expect(provider.calls).toBe(1);
}

async function chooseAppearance(page: Page, theme: "浅色" | "深色" | "高对比", options: { readonly reducedMotion?: boolean; readonly reducedTransparency?: boolean } = {}) {
  await page.getByRole("button", { name: "外观" }).click();
  await page.getByRole("radio", { name: theme }).check();
  if (options.reducedMotion) await page.getByRole("group", { name: "减少动态" }).getByRole("radio", { name: "开启" }).check();
  if (options.reducedTransparency) await page.getByRole("checkbox", { name: "减少透明" }).check();
  await page.getByRole("button", { name: "应用外观" }).click();
}

async function captureHealthyScreenshot(page: Page, testInfo: TestInfo, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await expect(page.locator("body")).toBeVisible();
  const output = testInfo.outputPath(name);
  const png = await page.screenshot({ path: output, animations: "disabled" });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(width);
  expect(png.readUInt32BE(20)).toBe(height);
  expect(png.byteLength).toBeGreaterThan(6_000);
  expect(new Set(png).size).toBeGreaterThan(64);
  return output;
}

test.describe("RI-48 real browser vertical slice", () => {
  test("App startup exposes an honest loading state before the local status projection is ready", async ({ page }) => {
    const server = await createResearchRoomServer({ languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/status", async (route) => { await gate; await route.continue(); });
    await page.goto(server.origin);
    await expect(page.getByText("Starting the local Research Room…", { exact: true })).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "打开研究项目" })).toBeVisible();
  });

  test("first run: explicit English choice is remembered across a new server and can be explicitly changed", async ({ page }) => {
    const preferences = new MemoryLanguagePreferenceStore(undefined);
    const first = await createResearchRoomServer({ languagePreferenceStore: preferences }).start(); servers.push(first);
    await page.goto(first.origin);

    await expect(page.getByRole("heading", { name: "选择界面语言 / Choose your language" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "打开研究项目" })).toBeHidden();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Open a research project" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Local service is ready");

    await first.close(); servers.pop();
    const restarted = await createResearchRoomServer({ languagePreferenceStore: preferences }).start(); servers.push(restarted);
    await page.goto(restarted.origin);
    await expect(page.getByRole("heading", { name: "Open a research project" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "选择界面语言 / Choose your language" })).toBeHidden();
    await page.getByRole("button", { name: "中文", exact: true }).click();
    await expect(page.getByRole("heading", { name: "打开研究项目" })).toBeVisible();

    await restarted.close(); servers.pop();
    const changed = await createResearchRoomServer({ languagePreferenceStore: preferences }).start(); servers.push(changed);
    await page.goto(changed.origin);
    await expect(page.getByRole("heading", { name: "打开研究项目" })).toBeVisible();
  });

  test("English mode: project initialization, Brief activation, and Room entry stay consistently English", async ({ page }) => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-browser-english-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const server = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(root) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("en") }).start(); servers.push(server);
    await page.goto(server.origin);

    await page.getByRole("button", { name: "Select a folder and open" }).click();
    await expect(page.getByRole("heading", { name: "Initialize this local project?" })).toBeVisible();
    await page.getByRole("button", { name: "Initialize project" }).click();
    await expect(page.getByRole("heading", { name: "Set the research working line" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Local initialization is complete");
    await page.getByLabel("Research question", { exact: true }).fill("How should a persistent language preference remain separate from research authority?");
    await page.getByLabel("Current smallest research task").fill("Verify the complete English first-run path.");
    await page.getByRole("button", { name: "Activate Brief and enter Research Room" }).click();
    await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
    await expect(page.getByText("How should a persistent language preference remain separate from research authority?", { exact: true })).toBeVisible();
    await expect(page.getByText("Choose text file", { exact: true })).toBeVisible();
    await expect(page.getByText("No file selected", { exact: true })).toBeVisible();
  });

  test("Provider settings: one external OpenAI-compatible configuration saves without a model call and never renders the key", async ({ page }, testInfo) => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-provider-ui-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const values = new Map<string, string>();
    const secrets: SecretBackend = {
      get: (ref) => Promise.resolve(values.get(ref)), set: (ref, value) => { values.set(ref, value); return Promise.resolve(); },
      delete: (ref) => { values.delete(ref); return Promise.resolve(); }, describe: (ref) => Promise.resolve({ configured: values.has(ref) }),
      health: () => Promise.resolve({ available: true, backend: "dpapi" }),
    };
    const providerConfigurationService = new ProviderConfigurationService(createFileProviderConfigStore({ filePath: join(root, "provider.json") }), secrets);
    const server = await createResearchRoomServer({ languagePreferenceStore: new MemoryLanguagePreferenceStore("en"), providerConfigurationService }).start(); servers.push(server);
    await page.goto(server.origin);
    await page.getByRole("button", { name: "Provider settings" }).click();
    const providerDialog = page.getByRole("dialog", { name: "Semantic Judge Provider" });
    await expect(providerDialog).toBeVisible();
    await providerDialog.getByLabel("Provider name").fill("external-judge");
    await providerDialog.getByLabel("Model").fill("judge-model");
    await providerDialog.getByLabel("Base URL").fill("https://models.example.test/v1");
    await providerDialog.getByLabel("API key (required for external HTTPS)").fill("browser-key-never-render");
    await providerDialog.getByRole("button", { name: "Save configuration" }).click();
    await expect(page.getByRole("status")).toContainText("no network request was made");
    await expect(providerDialog.locator("#provider-status-box")).toContainText("external-judge / judge-model");
    await expect(page.locator("body")).not.toContainText("browser-key-never-render");
    expect(await readFile(join(root, "provider.json"), "utf8")).not.toContain("browser-key-never-render");
    await captureHealthyScreenshot(page, testInfo, "provider-settings-1440x900.png", 1440, 900);
  });

  test("visual foundation: Light Start Center at 1280x800 and High Contrast forces reduced transparency", async ({ page }, testInfo) => {
    const server = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(undefined) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(server.origin);
    await chooseAppearance(page, "浅色", { reducedTransparency: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await captureHealthyScreenshot(page, testInfo, "ui01-light-start-center-1280x800.png", 1280, 800);

    await chooseAppearance(page, "高对比");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "high_contrast");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await page.mouse.move(0, 0);
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(2, 8, 23)");
    await expect(page.getByRole("button", { name: "选择文件夹并打开" })).toHaveCSS("background-color", "rgb(255, 212, 0)");
    await expect(page.getByRole("button", { name: "选择文件夹并打开" })).toHaveCSS("border-top-width", "2px");
    await captureHealthyScreenshot(page, testInfo, "ui01-vivid-high-contrast-start-center-1280x800.png", 1280, 800);
  });

  test("reduced motion: the desktop workflow remains operable without nonessential transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const server = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(undefined) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
    await page.goto(server.origin);
    await expect(page.getByRole("heading", { name: "打开研究项目" })).toBeVisible();
    await expect(page.locator(".start-center")).toHaveCSS("transition-duration", "0s");
    await page.getByText("手动输入绝对路径", { exact: true }).click();
    await expect(page.getByLabel("项目绝对路径")).toBeVisible();
  });

  test("primary mode: the system folder picker opens a plain directory without exposing a path field", async ({ page }) => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-browser-first-use-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const canary = join(root, "existing-research-canary.txt");
    await writeFile(canary, "must remain unchanged\n", "utf8");
    const server = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(root) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
    await page.goto(server.origin);

    await expect(page.getByRole("heading", { name: "打开研究项目" })).toBeVisible();
    await expect(page.locator(".boundary-list")).toContainText("仅在本机");
    await expect(page.locator(".boundary-list")).toContainText("不扫描磁盘");
    await page.getByRole("button", { name: "选择文件夹并打开" }).click();
    await expect(page.getByRole("heading", { name: "初始化这个本地项目？" })).toBeVisible();
    expect(await readFile(canary, "utf8")).toBe("must remain unchanged\n");
    await expect(async () => readdir(join(root, ".sestina"))).rejects.toThrow();
    await page.getByRole("button", { name: "初始化项目" }).click();
    await expect(page.getByRole("heading", { name: "建立这项研究的工作主线" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("已完成本地初始化，请定义 Brief");
    await page.getByLabel("研究问题", { exact: true }).fill("How should first-use browser initialization preserve research authority?");
    await page.getByLabel("当前最小研究任务").fill("Verify the browser-owned initialization boundary.");
    await page.getByRole("button", { name: "激活 Brief 并进入 Research Room" }).click();

    await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
    await expect(page.getByText("How should first-use browser initialization preserve research authority?", { exact: true })).toBeVisible();
    expect(await readFile(canary, "utf8")).toBe("must remain unchanged\n");
  });

  test("a slow system folder window can be cancelled immediately and returns to manual entry", async ({ page }) => {
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
    const cancelPicker = page.getByRole("button", { name: "取消文件夹窗口" });
    await expect(cancelPicker).toBeVisible();
    await cancelPicker.click();
    await expect(cancelPicker).toBeHidden();
    await expect(page.getByRole("status")).toContainText("已取消文件夹选择");
    await page.getByText("手动输入绝对路径", { exact: true }).click();
    await expect(page.getByLabel("项目绝对路径")).toBeEnabled();
  });

  test("fallback mode: manual absolute-path entry remains available", async ({ page }) => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-browser-manual-mode-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const server = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(undefined) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
    await page.goto(server.origin);

    await page.getByText("手动输入绝对路径", { exact: true }).click();
    await page.getByLabel("项目绝对路径").fill(root);
    await page.getByRole("button", { name: "检查此路径" }).click();
    await expect(page.getByRole("heading", { name: "初始化这个本地项目？" })).toBeVisible();
    await page.getByRole("button", { name: "初始化项目" }).click();
    await expect(page.getByRole("heading", { name: "建立这项研究的工作主线" })).toBeVisible();
  });

  test("reasonable increment: Manifest first, owner accepts, complete receipt persists", async ({ page }, testInfo) => {
    const fixture = await scenario("reasonable-increment"); const provider = new Ri48FixtureProvider("reasonable_increment");
    await openRoom(page, provider);
    await chooseAppearance(page, "深色");
    await captureHealthyScreenshot(page, testInfo, "ui01-dark-review-input-1440x900.png", 1440, 900);
    await prepareAndAnalyze(page, fixture, provider, async () => {
      await captureHealthyScreenshot(page, testInfo, "ui01-dark-manifest-inspector-1440x900.png", 1440, 900);
    });
    await captureHealthyScreenshot(page, testInfo, "ui01-dark-semantic-disposition-1440x900.png", 1440, 900);
    await page.getByLabel("你的处置理由").fill("The owner accepts the bounded synthetic increment.");
    await page.getByRole("button", { name: "接受", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已提交");
    await expect(page.locator(".receipt-list li").first()).toContainText("accepted");
    await expect(page.locator(".receipt-list li").first()).toContainText("committed");
    await expect(page.getByRole("button", { name: "下载凭证" })).toBeVisible();
    const downloadReady = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载凭证" }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toMatch(/^rrcp_[0-9A-HJKMNP-TV-Z]{26}\.json$/u);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    if (downloadPath) expect(JSON.parse(await readFile(downloadPath, "utf8"))).toMatchObject({ status: "committed", disposition: { kind: "accepted" } });
    await page.reload();
    await expect(page.getByRole("status")).toContainText("已从本地服务恢复已提交的项目状态");
    await expect(page.locator(".receipt-list li").first()).toContainText("accepted");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator(".receipt-list li").first().scrollIntoViewIfNeeded();
    await captureHealthyScreenshot(page, testInfo, "ui01-dark-receipt-1440x900.png", 1440, 900);
  });

  test("target substitution: owner alone performs formal redirect and can roll it back", async ({ page }, testInfo) => {
    const fixture = await scenario("target-substitution"); const provider = new Ri48FixtureProvider("target_substitution");
    await openRoom(page, provider);
    await chooseAppearance(page, "高对比");
    await prepareAndAnalyze(page, fixture, provider);
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await captureHealthyScreenshot(page, testInfo, "ui01-high-contrast-disposition-1728x1117.png", 1728, 1117);
    await page.getByLabel("你的处置理由").fill("The owner explicitly redirects the research question.");
    await page.getByRole("button", { name: "正式改向" }).click();
    await page.getByLabel("新的正式研究问题").fill("How should the synthetic selection mechanism itself be studied?");
    await page.getByRole("button", { name: "正式改向" }).click();
    await expect(page.getByText("How should the synthetic selection mechanism itself be studied?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "回滚" }).click();
    await page.getByLabel("回滚理由").fill("Restore the prior research direction.");
    await page.getByRole("button", { name: "确认回滚" }).click();
    await expect(page.getByText("How should a synthetic observational association be reported?", { exact: true })).toBeVisible();
    await expect(page.locator(".receipt-list li").first()).toContainText("rolled_back");
    await page.locator(".receipt-list li").first().scrollIntoViewIfNeeded();
    await captureHealthyScreenshot(page, testInfo, "ui01-high-contrast-rollback-1728x1117.png", 1728, 1117);
  });

  test("repeated audit: analysis rejects pseudo-depth without reopening resolved work", async ({ page }) => {
    const fixture = await scenario("repeated-audit"); const provider = new Ri48FixtureProvider("repeated_audit");
    await openRoom(page, provider); await prepareAndAnalyze(page, fixture, provider);
    await expect(page.locator("#delta")).toContainText("No traceable mechanism relation is added");
    await page.getByLabel("你的处置理由").fill("The owner rejects a repeated audit that adds no mechanism relation.");
    await page.getByRole("button", { name: "拒绝" }).click();
    await expect(page.locator(".receipt-list li").first()).toContainText("rejected");
    await expect(page.locator(".receipt-list li").first()).toContainText("committed");
  });

  test("keyboard-only main flow remains complete at 200% text with Inspector focus containment and restoration", async ({ page }, testInfo) => {
    const fixture = await scenario("reasonable-increment"); const provider = new Ri48FixtureProvider("reasonable_increment");
    const project = await createRi48Project(); cleanups.push(() => project.cleanup());
    const server = await createResearchRoomServer({ provider, directoryPicker: { pick: () => Promise.resolve(project.root) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { localStorage.setItem("sestina.app.appearance.v1", JSON.stringify({ version: 1, theme: "light", reducedMotion: "on", reducedTransparency: true })); });
    await page.route("**/assets/*.css", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\nhtml { font-size: 200% !important; }\n` });
    });
    await page.goto(server.origin);
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");

    const choose = page.getByRole("button", { name: "选择文件夹并打开" });
    await choose.focus();
    await expect(choose).toBeFocused();
    await expect(choose).not.toHaveCSS("outline-style", "none");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();

    const suggestion = page.getByLabel("单个建议");
    await suggestion.focus();
    await suggestion.pressSequentially(fixture.suggestion);
    const evidence = page.getByLabel("证据类别");
    await evidence.focus();
    await page.keyboard.press("ArrowDown");
    const prepare = page.getByRole("button", { name: "先生成 Context Manifest" });
    await prepare.focus();
    await page.keyboard.press("Enter");
    const inspector = page.getByRole("complementary", { name: "Context Inspector" });
    await expect(inspector.getByRole("button", { name: "关闭 Inspector" })).toBeFocused();
    await expect(inspector).toHaveCSS("position", "fixed");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-inspector-return]").first()).toBeFocused();

    const analyze = page.getByRole("button", { name: "我已核对，开始分析" });
    await analyze.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#findings")).toContainText("reasonable_increment");
    await expect(inspector.getByRole("button", { name: "关闭 Inspector" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-inspector-return]").first()).toBeFocused();

    const reason = page.getByLabel("你的处置理由");
    await reason.focus();
    await reason.pressSequentially("The owner accepts the bounded keyboard-only review.");
    const accept = page.getByRole("button", { name: "接受", exact: true });
    await accept.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".receipt-list li").first()).toContainText("accepted");
    await expect(inspector.getByRole("button", { name: "关闭 Inspector" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".receipt-summary").first()).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    const horizontalOverflows = await page.evaluate<readonly { readonly tag: string; readonly className: string; readonly text?: string; readonly right: number }[]>(`[...document.querySelectorAll("body *")].filter((element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = element.getBoundingClientRect();
      return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1;
    }).map((element) => ({ tag: element.tagName, className: String(element.className), text: element.textContent?.trim().slice(0, 80), right: Math.round(element.getBoundingClientRect().right) })).slice(0, 20)`);
    expect(horizontalOverflows).toEqual([]);
    await page.locator(".receipt-list li").first().scrollIntoViewIfNeeded();
    await captureHealthyScreenshot(page, testInfo, "ui01-light-keyboard-receipt-200pct-1280x800.png", 1280, 800);
  });

  test("in-flight cancel aborts the Provider and leaves no analysis, Finding, Authority action, or receipt", async ({ page }) => {
    const provider = new CancellableBrowserProvider();
    await openRoom(page, provider);
    await page.getByLabel("单个建议").fill("Cancel this synthetic browser analysis before a result exists.");
    await page.getByLabel("证据类别").selectOption("synthetic_fixture");
    await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "我已核对，开始分析" }).click();
    await provider.started;
    await expect(page.locator(".app-chrome__status")).toContainText("正在分析");
    await page.getByRole("button", { name: "取消分析" }).click();
    await expect(page.getByRole("status")).toContainText("审议已取消");
    expect(provider.aborted).toBe(true);
    await expect(page.locator("#findings")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Authority Gate — 只有你能处置" })).toHaveCount(0);
    await expect(page.locator(".receipt-list li")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "先生成 Context Manifest" })).toBeEnabled();
  });

  test("Provider failure degrades to ledger_only and disables authoritative acceptance without partial receipt", async ({ page }, testInfo) => {
    const provider = new FailingBrowserProvider();
    await openRoom(page, provider);
    await page.getByLabel("单个建议").fill("A synthetic suggestion whose Provider fails.");
    await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
    await page.getByRole("button", { name: "我已核对，开始分析" }).click();
    await expect(page.locator("#findings")).toContainText("provider_unavailable");
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toContainText("provider_failed");
    await expect(page.getByRole("button", { name: "接受", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "拒绝" })).toBeEnabled();
    await expect(page.locator(".receipt-list li")).toHaveCount(0);
    await captureHealthyScreenshot(page, testInfo, "ui01-degraded-provider-1440x900.png", 1440, 900);
  });

  test("invalid API payload fails closed into a recoverable Inspector state", async ({ page }, testInfo) => {
    const provider = new Ri48FixtureProvider();
    await openRoom(page, provider);
    await page.getByLabel("单个建议").fill("A synthetic suggestion with a malformed boundary response.");
    await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
    await page.keyboard.press("Escape");
    await page.route("**/api/reviews/analyze", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, value: { malformed: true } }) }));
    await page.getByRole("button", { name: "我已核对，开始分析" }).click();
    await expect(page.locator(".app-chrome__status")).toContainText("无效响应");
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toContainText("invalid_payload");
    await expect(page.locator("#findings")).toHaveCount(0);
    await expect(page.locator(".receipt-list li")).toHaveCount(0);
    await captureHealthyScreenshot(page, testInfo, "ui01-invalid-response-1440x900.png", 1440, 900);
  });

  test("offline mutation failure is explicit and keeps the committed-state area untouched", async ({ page }, testInfo) => {
    const provider = new Ri48FixtureProvider();
    const opened = await openRoom(page, provider);
    await opened.server.close(); servers.pop();
    await page.getByLabel("单个建议").fill("A synthetic suggestion while the local service is offline.");
    await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
    await expect(page.locator(".app-chrome__status")).toContainText("离线");
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toContainText("offline");
    await expect(page.locator(".receipt-list li")).toHaveCount(0);
    await captureHealthyScreenshot(page, testInfo, "ui01-offline-recovery-1440x900.png", 1440, 900);
  });
});
