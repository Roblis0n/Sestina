import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../../apps/research-room/src/language-preferences.js";
import { ProviderConfigurationService, createFileProviderConfigStore } from "../../apps/research-room/src/provider-settings.js";
import type { SecretBackend } from "../../packages/secrets/src/index.js";
import { createRi48Project, Ri48FixtureProvider } from "../helpers/ri48-project.js";

type Scenario = "reasonable-increment" | "target-substitution" | "repeated-audit";
interface ScenarioFixture { readonly suggestion: string; readonly evidenceClass: "synthetic_fixture" | "synthetic_adversarial_fixture"; readonly expected: { readonly findingKind: string } }

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
  await expect(page.getByRole("heading", { name: "当前研究状态" })).toBeVisible();
  await expect(page.getByText("How should a synthetic observational association be reported?", { exact: true })).toBeVisible();
  return fixture;
}

async function prepareAndAnalyze(page: Page, fixture: ScenarioFixture, provider: Ri48FixtureProvider) {
  await page.getByLabel("单个建议").fill(fixture.suggestion);
  await page.getByLabel("证据类别").selectOption(fixture.evidenceClass);
  await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
  await expect(page.getByRole("heading", { name: "Context Manifest（发送前）" })).toBeVisible();
  await expect(page.getByText(/当前未发送/u)).toBeVisible();
  await expect(page.getByText(/protocol 1\.0\.0/u)).toBeVisible();
  await expect(page.locator("#manifest-excluded")).toContainText("api_keys");
  expect(provider.calls).toBe(0);
  await page.getByRole("button", { name: "我已核对，开始分析" }).click();
  await expect(page.locator("#findings")).toContainText(fixture.expected.findingKind);
  await expect(page.getByRole("heading", { name: "Authority Gate — 只有你能处置" })).toBeVisible();
  expect(provider.calls).toBe(1);
}

test.describe("RI-48 real browser vertical slice", () => {
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
    await expect(page.getByRole("heading", { name: "Set the research working line" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Local initialization is complete");
    await page.getByLabel("Research question", { exact: true }).fill("How should a persistent language preference remain separate from research authority?");
    await page.getByLabel("Current smallest research task").fill("Verify the complete English first-run path.");
    await page.getByRole("button", { name: "Activate Brief and enter Research Room" }).click();
    await expect(page.getByRole("heading", { name: "Current research state" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Semantic Judge Provider" })).toBeVisible();
    await page.getByLabel("Provider name").fill("external-judge");
    await page.getByLabel("Model").fill("judge-model");
    await page.getByLabel("Base URL").fill("https://models.example.test/v1");
    await page.getByLabel("API key (required for external HTTPS)").fill("browser-key-never-render");
    await page.getByRole("button", { name: "Save configuration" }).click();
    await expect(page.getByRole("status")).toContainText("no network request was made");
    await expect(page.locator("#provider-status-box")).toContainText("external-judge / judge-model");
    await expect(page.locator("body")).not.toContainText("browser-key-never-render");
    expect(await readFile(join(root, "provider.json"), "utf8")).not.toContain("browser-key-never-render");
    await page.screenshot({ path: testInfo.outputPath("provider-settings.png"), fullPage: true });
  });

  test("reduced motion: the desktop workflow remains operable without nonessential transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const server = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(undefined) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
    await page.goto(server.origin);
    await expect(page.getByRole("heading", { name: "打开研究项目" })).toBeVisible();
    await expect(page.locator("#project-launch")).toHaveCSS("animation-name", "none");
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
    await expect(page.locator("#project-launch")).toHaveCSS("animation-name", "view-in");
    await expect(page.getByText("仅在本机", { exact: true })).toBeVisible();
    await expect(page.getByText("不扫描目录", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "选择文件夹并打开" }).click();
    await expect(page.getByRole("heading", { name: "建立这项研究的工作主线" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("已在所选文件夹完成本地初始化");
    await page.getByLabel("研究问题", { exact: true }).fill("How should first-use browser initialization preserve research authority?");
    await page.getByLabel("当前最小研究任务").fill("Verify the browser-owned initialization boundary.");
    await page.getByRole("button", { name: "激活 Brief 并进入 Research Room" }).click();

    await expect(page.getByRole("heading", { name: "当前研究状态" })).toBeVisible();
    await expect(page.getByText("How should first-use browser initialization preserve research authority?", { exact: true })).toBeVisible();
    expect(await readFile(canary, "utf8")).toBe("must remain unchanged\n");
  });

  test("fallback mode: manual absolute-path entry remains available", async ({ page }) => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-browser-manual-mode-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const server = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(undefined) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start(); servers.push(server);
    await page.goto(server.origin);

    await page.getByText("手动输入绝对路径", { exact: true }).click();
    await page.getByLabel("项目绝对路径").fill(root);
    await page.getByRole("button", { name: "按此路径打开或初始化" }).click();
    await expect(page.getByRole("heading", { name: "建立这项研究的工作主线" })).toBeVisible();
  });

  test("reasonable increment: Manifest first, owner accepts, complete receipt persists", async ({ page }, testInfo) => {
    const fixture = await scenario("reasonable-increment"); const provider = new Ri48FixtureProvider("reasonable_increment");
    await openRoom(page, provider); await prepareAndAnalyze(page, fixture, provider);
    await page.screenshot({ path: testInfo.outputPath("semantic-analysis.png"), fullPage: true });
    await page.getByLabel("你的处置理由").fill("The owner accepts the bounded synthetic increment.");
    await page.getByRole("button", { name: "接受", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已提交");
    await expect(page.getByText("accepted · committed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "下载凭证" })).toBeVisible();
  });

  test("target substitution: owner alone performs formal redirect and can roll it back", async ({ page }) => {
    const fixture = await scenario("target-substitution"); const provider = new Ri48FixtureProvider("target_substitution");
    await openRoom(page, provider); await prepareAndAnalyze(page, fixture, provider);
    await page.getByLabel("你的处置理由").fill("The owner explicitly redirects the research question.");
    await page.getByRole("button", { name: "正式改向" }).click();
    await page.getByLabel("新的正式研究问题").fill("How should the synthetic selection mechanism itself be studied?");
    await page.getByRole("button", { name: "正式改向" }).click();
    await expect(page.getByText("How should the synthetic selection mechanism itself be studied?", { exact: true })).toBeVisible();
    page.once("dialog", async (dialog) => dialog.accept("Restore the prior research direction."));
    await page.getByRole("button", { name: "回滚" }).click();
    await expect(page.getByText("How should a synthetic observational association be reported?", { exact: true })).toBeVisible();
    await expect(page.getByText("direction_changed · rolled_back", { exact: true })).toBeVisible();
  });

  test("repeated audit: analysis rejects pseudo-depth without reopening resolved work", async ({ page }) => {
    const fixture = await scenario("repeated-audit"); const provider = new Ri48FixtureProvider("repeated_audit");
    await openRoom(page, provider); await prepareAndAnalyze(page, fixture, provider);
    await expect(page.locator("#delta")).toContainText("No traceable mechanism relation is added");
    await page.getByLabel("你的处置理由").fill("The owner rejects a repeated audit that adds no mechanism relation.");
    await page.getByRole("button", { name: "拒绝" }).click();
    await expect(page.getByText("rejected · committed", { exact: true })).toBeVisible();
  });
});
