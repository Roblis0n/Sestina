import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createResearchRoomServer, type ClosedExternalAppHostRuntime, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../../apps/research-room/src/language-preferences.js";
import { createRi51Project, type Ri51ProjectFixture } from "../helpers/ri51-project.js";
import { Ri52FixtureHostRuntime, Ri52UnavailableHostRuntime } from "../helpers/ri52-runtime.js";

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

async function openProject(page: Page, fixture: Ri51ProjectFixture, runtime: ClosedExternalAppHostRuntime, language: AppLanguage = "zh-CN"): Promise<RunningResearchRoomServer> {
  const server = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(fixture.root) }, languagePreferenceStore: new MemoryLanguagePreferenceStore(language), closedExternalAppHostRuntime: runtime }).start();
  servers.push(server);
  await page.goto(server.origin);
  await expect(page.getByRole("status")).toContainText(language === "en" ? "Local service is ready" : "本地服务已就绪");
  await page.getByRole("button", { name: language === "en" ? "Choose folder and open" : "选择文件夹并打开" }).click();
  await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
  return server;
}

async function openPilot(page: Page): Promise<void> {
  await page.getByRole("button", { name: /打开 Pilot|Open Pilot/u }).click();
  await expect(page.getByRole("heading", { name: /封闭式 Codex 外部 App Pilot|Closed Codex External App Pilot/u })).toBeVisible();
}

async function startPilot(page: Page): Promise<void> {
  await page.getByRole("button", { name: /启动封闭式 Pilot|Start a closed Pilot/u }).click();
  await expect(page).toHaveURL(/\/project\/external-app-pilot\/rpil_/u);
  await expect(page.locator(".pilot-stage").first()).toBeVisible();
}

async function prepareAndConfirm(page: Page, button = /生成精确 Manifest|Prepare exact Manifest/u): Promise<string> {
  await page.getByRole("button", { name: button }).click();
  const manifest = page.locator(".pilot-manifest");
  await expect(manifest).toContainText(/实际 UTF-8 字节|Actual UTF-8 bytes/u);
  await expect(page.locator(".pilot-consequence-grid")).toContainText("精确 Manifest 预览已写入；尚未向 Codex 发送任何字节");
  await expect(page.locator(".pilot-consequence-grid")).toContainText("确认这一份 hash 与 attempt");
  await manifest.locator("details").getByText(/将实际发送的精确字节|Exact bytes that will be sent/u).click();
  const payload = await manifest.locator("pre").textContent();
  expect(payload).toBeTruthy();
  await page.getByRole("button", { name: /确认这一份精确 payload|Confirm this exact payload/u }).click();
  await expect(page.locator(".pilot-consequence-grid")).toContainText("精确 Context 确认已绑定到这一 Pilot、attempt 与 hash");
  await expect(page.locator(".pilot-consequence-grid")).toContainText("宿主尚未启动，尚无 candidate 或连续性观察");
  await expect(page.getByRole("button", { name: /启动已确认的 Codex 任务|Launch confirmed Codex task/u })).toBeVisible();
  return payload ?? "";
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

async function capture(page: Page, testInfo: TestInfo, name: string, width: number, height: number, fullPage = false): Promise<void> {
  await page.setViewportSize({ width, height });
  await expectNoHorizontalOverflow(page);
  const png = await page.screenshot({ path: testInfo.outputPath(name), animations: "disabled", fullPage });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.byteLength).toBeGreaterThan(10_000);
}

test.describe("RI-52 production Closed External App Pilot", () => {
  test("completes exact disclosure, bounded host, candidate, restored Review, user disposition, Receipt, fresh session, and local evidence", async ({ page }, testInfo) => {
    const fixture = await createRi51Project(); cleanups.push(() => fixture.cleanup());
    const runtime = new Ri52FixtureHostRuntime(fixture.acceptedDecisionId);
    runtime.delayMs = 2_500;
    await openProject(page, fixture, runtime);
    await openPilot(page); await startPilot(page);
    await expect(page.getByText("Codex Host Adapter")).toHaveCount(0);
    await expect(page.locator(".pilot-capabilities")).toContainText("observed");
    await expect(page.locator(".pilot-consequence-grid")).toContainText("尚无 Context、candidate、Review、Receipt");
    await capture(page, testInfo, "ri52-preflight-zh-light-1440x900.png", 1440, 900);

    await expect(page.locator(".pilot-memory-selection input:checked")).toHaveCount(0);
    const eligible = page.locator(".pilot-memory-selection label").filter({ hasText: fixture.eligibleSearchToken });
    await eligible.getByRole("checkbox").check();
    const previewPayload = await prepareAndConfirm(page);
    await expect(page.locator(".pilot-manifest")).toContainText("never_send included 0");
    await capture(page, testInfo, "ri52-manifest-selected-memory-zh-light-1280x900.png", 1280, 900, true);

    await page.getByRole("button", { name: "启动已确认的 Codex 任务" }).click();
    await expect(page.getByRole("region", { name: "Codex 正在运行" })).toBeVisible();
    await capture(page, testInfo, "ri52-running-zh-light-1440x900.png", 1440, 900);
    await expect(page.getByRole("heading", { name: "4 · Candidate" })).toBeVisible();
    await expect(page.locator(".pilot-candidate")).toContainText("model_proposed");
    await expect(page.locator(".pilot-candidate")).toContainText("canMutateAuthority=false");
    expect(runtime.observations[0]?.contextUtf8).toBe(previewPayload);
    expect(Buffer.byteLength(runtime.observations[0]?.contextUtf8 ?? "", "utf8")).toBeGreaterThan(0);
    await capture(page, testInfo, "ri52-candidate-long-zh-light-1728x1000.png", 1728, 1000, true);

    await page.getByRole("button", { name: "搜索项目内容" }).click();
    await page.getByRole("searchbox", { name: "项目内搜索" }).fill("Codex Pilot");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const searchResult = page.getByRole("region", { name: "搜索结果" }).getByRole("button").filter({ hasText: "candidate_confirmation_required" });
    await expect(searchResult).toContainText("external_app_pilot");
    await searchResult.click();
    await expect(page.locator(".pilot-candidate")).toBeVisible();

    await page.locator(".object-nav-link").filter({ hasText: "待处理" }).click();
    const attention = page.locator(".attention-list li button").filter({ hasText: "Codex candidate" });
    await expect(attention).toContainText("external_app_pilot");
    await attention.click();
    await page.getByRole("button", { name: "导入为非权威候选" }).click();
    await expect(page.locator(".pilot-consequence-grid")).toContainText("尚无用户处置或 Authority 改变");

    await page.reload();
    await expect(page.getByRole("button", { name: "恢复已绑定 Review" })).toBeVisible();
    await page.getByRole("button", { name: "恢复已绑定 Review" }).click();
    await page.getByRole("button", { name: "运行既有 Sestina Review" }).click();
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pilot-review-result")).toContainText("ledger_only");
    await expect(page.getByRole("button", { name: "接受", exact: true })).toBeDisabled();
    await page.getByLabel("公开处置理由").fill("用户在确定性 ledger Review 后暂缓该模型建议，并保留全部 Authority 边界。");
    await page.getByRole("button", { name: "暂缓", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "打开 Receipt / Trace" })).toContainText("committed");
    await expect(page.locator(".pilot-consequence-grid")).toContainText("用户处置与 Receipt/Trace 已写入 canonical state");
    await expect(page.locator(".pilot-consequence-grid")).toContainText("尚无第二个全新 Codex 会话的连续性证据");
    await expect(page.locator(".pilot-consequence-grid")).toContainText("生成并确认全新会话 Manifest");
    await capture(page, testInfo, "ri52-disposition-receipt-zh-light-1440x900.png", 1440, 900, true);
    await page.getByRole("button", { name: "打开 Receipt / Trace" }).click();
    await expect(page).toHaveURL(/\/project\/receipts\/rrcp_/u);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "6 · 全新会话连续性复核" })).toBeVisible();

    const continuityPayload = await prepareAndConfirm(page, /生成全新会话 Manifest|Prepare fresh-session Manifest/u);
    await expect(page.locator(".pilot-manifest")).toContainText("Working Memory");
    await expect(page.locator(".pilot-manifest")).toContainText("0 · never_send included 0");
    await page.getByRole("button", { name: "启动已确认的 Codex 任务" }).click();
    await expect(page.locator(".pilot-continuity-result")).toContainText("host_observation");
    expect(runtime.observations).toHaveLength(2);
    expect(runtime.observations[1]?.contextUtf8).toBe(continuityPayload);
    expect(continuityPayload).not.toContain("Bounded external candidate");
    await capture(page, testInfo, "ri52-continuity-verified-zh-light-1920x1080.png", 1920, 1080, true);

    await page.locator(".pilot-feedback label").filter({ hasText: "useful" }).first().getByRole("checkbox").check();
    await page.getByLabel(/可选本地备注/u).fill("本地 owner-operated fixture 仅证明产品闭环，不进入外部用户证据。");
    await page.getByRole("button", { name: "保存本地反馈" }).click();
    await page.getByRole("button", { name: "关闭 Pilot" }).click();
    await expect(page.locator(".pilot-evidence-summary")).toContainText("External-user evidence");
    await expect(page.locator(".pilot-evidence-summary")).toContainText("0");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出最小证据报告" }).click();
    expect((await download).suggestedFilename()).toMatch(/^sestina-ri52-rpil_.*-evidence\.json$/u);
    await page.reload();
    await expect(page.locator(".pilot-evidence-summary")).toContainText("closed");
  });

  test("preserves hierarchy, keyboard access, long context, themes, languages, reduced modes, 200 percent text, and all desktop widths", async ({ page }, testInfo) => {
    const fixture = await createRi51Project(); cleanups.push(() => fixture.cleanup());
    const runtime = new Ri52FixtureHostRuntime(fixture.acceptedDecisionId); runtime.delayMs = 100;
    await openProject(page, fixture, runtime); await openPilot(page); await startPilot(page);
    await expect(page.locator(".pilot-capabilities")).toContainText("结构化输出");
    await expect(page.locator(".pilot-capabilities")).not.toContainText("structuredOutput");
    const providerTrigger = page.getByRole("button", { name: "Provider 设置" });
    await providerTrigger.click();
    await expect(page.getByRole("region", { name: "Codex Host Adapter" })).toContainText("它不是上方的 Sestina Provider");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Semantic Judge Provider" })).toBeHidden();
    await expect(providerTrigger).toBeFocused();
    await capture(page, testInfo, "ri52-light-zh-preflight-1920x1080.png", 1920, 1080);
    await page.locator(".pilot-memory-selection label").filter({ hasText: fixture.eligibleSearchToken }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "生成精确 Manifest" }).click();
    await capture(page, testInfo, "ri52-light-zh-manifest-1280x800.png", 1280, 800, true);

    await page.getByRole("button", { name: "外观" }).click();
    await page.getByRole("radio", { name: "深色" }).check();
    await page.getByRole("group", { name: "减少动态" }).getByRole("radio", { name: "开启" }).check();
    await page.getByRole("checkbox", { name: "减少透明" }).check();
    await page.getByRole("button", { name: "应用外观" }).click();
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await capture(page, testInfo, "ri52-dark-en-reduced-manifest-1728x1000.png", 1728, 1000, true);

    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "High contrast" }).check();
    await page.getByRole("button", { name: "Apply appearance" }).click();
    await page.evaluate('document.documentElement.style.setProperty("font-size", "200%", "important")');
    await page.locator(".pilot-manifest").scrollIntoViewIfNeeded();
    await expect(page.locator(".pilot-manifest")).toBeVisible();
    await capture(page, testInfo, "ri52-high-contrast-en-200pct-manifest-1100x800.png", 1100, 800);
    await page.keyboard.press("Tab");
    const activeTagName = await page.evaluate<string>('document.activeElement?.tagName ?? ""');
    expect(activeTagName).toMatch(/BUTTON|INPUT|SUMMARY|TEXTAREA/u);
    await page.evaluate('document.documentElement.style.removeProperty("font-size")');

    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Light" }).check();
    await page.getByRole("button", { name: "Apply appearance" }).click();
    await capture(page, testInfo, "ri52-light-en-manifest-1440x900.png", 1440, 900, true);
    await page.getByRole("button", { name: "中文", exact: true }).click();
    await capture(page, testInfo, "ri52-light-zh-manifest-1280x900.png", 1280, 900, true);
  });

  test("shows honest host unavailable, timeout, context mismatch, protocol mismatch, cancellation, and restart recovery", async ({ page }, testInfo) => {
    const fixture = await createRi51Project(); cleanups.push(() => fixture.cleanup());
    let server = await openProject(page, fixture, new Ri52UnavailableHostRuntime()); await openPilot(page); await startPilot(page);
    await expect(page.getByRole("alert", { name: "host_unavailable" })).toContainText("no context was sent");
    await capture(page, testInfo, "ri52-host-unavailable-zh-light-1280x800.png", 1280, 800);
    servers.splice(servers.indexOf(server), 1); await server.close();

    const runtime = new Ri52FixtureHostRuntime(fixture.acceptedDecisionId); runtime.delayMs = 120;
    server = await openProject(page, fixture, runtime); await openPilot(page); await page.getByRole("button", { name: "启动另一个 Pilot" }).click();
    for (const [code, screenshot] of [["host_timeout", "ri52-timeout-zh-light-1440x900.png"], ["context_binding_mismatch", "ri52-context-mismatch-zh-light-1440x900.png"], ["host_protocol_mismatch", "ri52-protocol-mismatch-zh-light-1440x900.png"]] as const) {
      runtime.failureCode = code;
      await prepareAndConfirm(page); await page.getByRole("button", { name: "启动已确认的 Codex 任务" }).click();
      await expect(page.getByRole("alert", { name: code })).toBeVisible();
      await capture(page, testInfo, screenshot, 1440, 900);
      await page.getByRole("button", { name: "启动另一个 Pilot" }).click();
    }

    runtime.failureCode = undefined; runtime.delayMs = 8_000;
    await page.getByRole("button", { name: "生成精确 Manifest" }).click();
    await page.getByRole("button", { name: "确认这一份精确 payload" }).click();
    await page.getByRole("button", { name: "启动已确认的 Codex 任务" }).click();
    await expect(page.getByRole("region", { name: "Codex 正在运行" })).toBeVisible();
    await page.getByRole("button", { name: "取消运行任务" }).click();
    await expect(page.locator(".pilot-consequence-grid")).toContainText("没有晚到结果、candidate 或自动重试");
    await capture(page, testInfo, "ri52-cancelled-zh-light-1440x900.png", 1440, 900);

    await page.getByRole("button", { name: "启动另一个 Pilot" }).click();
    await page.getByRole("button", { name: "生成精确 Manifest" }).click();
    await page.getByRole("button", { name: "确认这一份精确 payload" }).click();
    await page.getByRole("button", { name: "启动已确认的 Codex 任务" }).click();
    await expect(page.getByRole("region", { name: "Codex 正在运行" })).toBeVisible();
    const interruptedUrl = page.url();
    servers.splice(servers.indexOf(server), 1); await server.close();
    runtime.delayMs = 100;
    const reopened = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(fixture.root) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"), closedExternalAppHostRuntime: runtime }).start(); servers.push(reopened);
    await page.goto(reopened.origin); await expect(page.getByRole("status")).toContainText("本地服务已就绪"); await page.getByRole("button", { name: "选择文件夹并打开" }).click();
    const interruptedPath = new URL(interruptedUrl).pathname; await page.goto(`${reopened.origin}${interruptedPath}`);
    await expect(page.locator(".pilot-consequence-grid")).toContainText("interrupted_unknown");
    await expect(page.getByRole("alert", { name: "invocation_interrupted_after_restart" })).toBeVisible();
    await expect(page.getByRole("button", { name: "生成精确 Manifest" })).toBeVisible();
    await capture(page, testInfo, "ri52-restart-interrupted-zh-light-1440x900.png", 1440, 900);
  });
});
