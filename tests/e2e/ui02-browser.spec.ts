import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../../apps/research-room/src/language-preferences.js";
import { Ri48FixtureProvider } from "../helpers/ri48-project.js";
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

async function startRoom(page: Page, projects: readonly Ui02ProjectFixture[], provider?: Ri48FixtureProvider): Promise<RunningResearchRoomServer> {
  let pickerIndex = 0;
  const server = await createResearchRoomServer({
    ...(provider ? { provider } : {}),
    directoryPicker: { pick: () => Promise.resolve(projects[pickerIndex++]?.root) },
    languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"),
  }).start();
  servers.push(server);
  await page.goto(server.origin);
  await expect(page.getByRole("status")).toContainText("本地服务已就绪");
  await page.getByRole("button", { name: "选择文件夹并打开" }).click();
  await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
  await expect(page.locator(".project-navigation")).toContainText(projects[0]?.title ?? "");
  return server;
}

async function objectNav(page: Page, name: string): Promise<void> {
  await page.locator(".object-nav-link").filter({ hasText: name }).click();
}

async function navigateInApp(page: Page, path: string): Promise<void> {
  await page.evaluate(`window.history.pushState({}, "", ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent("popstate"));`);
}

async function closeInspector(page: Page): Promise<void> {
  const inspector = page.locator(".context-inspector[data-open='true']");
  if (await inspector.count()) {
    await page.keyboard.press("Escape");
    await expect(page.locator(".context-inspector")).toHaveAttribute("data-open", "false");
  }
}

async function prepareAndAnalyze(page: Page, provider?: Ri48FixtureProvider): Promise<void> {
  await page.getByLabel("单个建议").fill("Add one bounded uncertainty statement while preserving the current research question and user authority.");
  await page.getByLabel("证据类别").selectOption("synthetic_fixture");
  await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).toContainText(provider ? provider.id : "ledger_only");
  await closeInspector(page);
  await page.getByRole("button", { name: "我已核对，开始分析" }).click();
  await expect(page.getByRole("heading", { name: "Authority Gate — 只有你能处置" })).toBeVisible();
  await closeInspector(page);
}

async function chooseAppearance(page: Page, language: "zh" | "en", theme: "light" | "dark" | "high_contrast", reduced = false): Promise<void> {
  const labels = language === "zh"
    ? { appearance: "外观", light: "浅色", dark: "深色", high_contrast: "高对比", motionGroup: "减少动态", motionOn: "开启", transparency: "减少透明", apply: "应用外观" }
    : { appearance: "Appearance", light: "Light", dark: "Dark", high_contrast: "High contrast", motionGroup: "Reduced motion", motionOn: "On", transparency: "Reduced transparency", apply: "Apply appearance" };
  await page.getByRole("button", { name: labels.appearance }).click();
  await page.getByRole("radio", { name: labels[theme] }).check();
  if (reduced) {
    await page.getByRole("group", { name: labels.motionGroup }).getByRole("radio", { name: labels.motionOn }).check();
    await page.getByRole("checkbox", { name: labels.transparency }).check();
  }
  await page.getByRole("button", { name: labels.apply }).click();
}

async function captureHealthyScreenshot(page: Page, testInfo: TestInfo, name: string, width: number, height: number): Promise<string> {
  await page.setViewportSize({ width, height });
  await page.evaluate("window.scrollTo(0, 0)");
  await expect(page.locator("body")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const output = testInfo.outputPath(name);
  const png = await page.screenshot({ path: output, animations: "disabled" });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(width);
  expect(png.readUInt32BE(20)).toBe(height);
  expect(png.byteLength).toBeGreaterThan(8_000);
  expect(new Set(png).size).toBeGreaterThan(64);
  await testInfo.attach(name, { path: output, contentType: "image/png" });
  return output;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate<readonly { readonly tag: string; readonly className: string; readonly right: number }[]>(`[...document.querySelectorAll("body *")].filter((element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1;
  }).map((element) => ({ tag: element.tagName, className: String(element.className), right: Math.round(element.getBoundingClientRect().right) })).slice(0, 20)`);
  expect(overflow).toEqual([]);
}

test.describe("UI-02 production research object workspaces", () => {
  test("runs the complete Brief, Decision, Issue, Evidence, Episode, search, Attention, Receipt, and rollback flow", async ({ page }) => {
    const fixture = await createUi02Project(); cleanups.push(() => fixture.cleanup());
    const provider = new Ri48FixtureProvider("reasonable_increment");
    await startRoom(page, [fixture], provider);

    await objectNav(page, "项目概览");
    await expect(page.getByRole("heading", { name: "项目概览" })).toBeVisible();
    await expect(page.locator(".overview-primary")).toContainText(fixture.question);
    await expect(page.locator(".overview-ledger-lines")).toContainText("decision");
    await expect(page.locator(".overview-ledger-lines")).toContainText("issue");
    await expect(page.locator(".continuity-anchors")).toContainText(fixture.episodeId);

    await objectNav(page, "Research Brief");
    await page.getByRole("button", { name: "创建 candidate" }).click();
    await expect(page.getByRole("textbox", { name: "研究问题", exact: true })).toBeVisible();
    const changedTask = "Activate one reviewed UI-02 continuity change and publish its durable projection.";
    await page.locator(".structured-editor textarea[name='currentTask']").fill(changedTask);
    await page.getByLabel("Candidate 理由").fill("Make the current object-workspace validation task explicit.");
    await page.getByRole("button", { name: "保存 pending candidate" }).click();
    await expect(page.locator(".brief-main-fields")).toContainText(fixture.originalTask);
    await expect(page.locator(".candidate")).toContainText("pending");
    await expect(page.locator(".candidate")).toContainText(changedTask);
    await page.getByLabel("激活理由").fill("The owner reviewed the field diff and accepts this bounded task change.");
    await page.getByLabel(/我已核对字段 diff 与影响/u).check();
    await page.getByRole("button", { name: "激活 candidate" }).click();
    await expect(page.locator(".brief-main-fields")).toContainText(changedTask);
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("v2");
    expect(await readFile(join(fixture.root, ".sestina", "research-brief.yaml"), "utf8")).toContain(changedTask);

    await objectNav(page, "Decisions");
    await page.getByRole("button", { name: "记录 proposed Decision" }).click();
    const proposedStatement = "Use bounded, project-local projections as the only source for UI-02 object screens.";
    await page.getByLabel("陈述").fill(proposedStatement);
    await page.getByLabel("依据").fill("This preserves canonical state, provenance, and project isolation.");
    await page.getByLabel("重开条件").fill("The projection contract changes.");
    await page.getByLabel("命令理由").fill("Record the reviewed Decision proposal.");
    await page.getByRole("button", { name: "记录提案" }).click();
    await expect(page.getByRole("heading", { name: proposedStatement })).toBeVisible();
    await expect(page.locator(".authority-gate")).toContainText("accept · reject");
    await page.getByLabel("理由", { exact: true }).fill("The owner accepts this project-local projection boundary.");
    await page.getByRole("button", { name: "接受", exact: true }).click();
    await expect(page.locator(".authority-gate")).toContainText("freeze · supersede");
    await page.getByRole("button", { name: "替代……" }).click();
    const replacementStatement = "Use versioned, bounded, project-local projections as the only source for UI-02 object screens.";
    await page.getByLabel("替代陈述").fill(replacementStatement);
    await page.getByLabel("依据", { exact: true }).fill("The replacement makes the version and bound requirements explicit.");
    await page.getByLabel("重开条件", { exact: true }).fill("The bounded cursor contract changes.");
    await page.getByLabel("替代理由").fill("Replace the accepted Decision while preserving its lineage.");
    await page.getByRole("button", { name: "确认替代" }).click();
    await expect(page.getByRole("heading", { name: replacementStatement })).toBeVisible();
    await expect(page.locator(".lineage-list")).toContainText(proposedStatement);
    await expect(page.locator(".lineage-list")).toContainText("superseded");

    await objectNav(page, "Issues");
    await page.getByLabel("类型").selectOption("evidence_boundary");
    await expect(page.locator(".ledger-list li")).toHaveCount(1);
    await page.getByLabel("类型").selectOption("");
    await page.getByRole("button", { name: /Resolve the evidence boundary/u }).click();
    const resolve = page.locator(".command-accordions details").filter({ hasText: "解决" });
    await resolve.locator("summary").click();
    await resolve.getByLabel("Canonical Evidence ID（规范证据 ID）").fill(fixture.evidenceId);
    await resolve.getByLabel("理由", { exact: true }).fill("Bind the open Issue to current canonical project Evidence.");
    await resolve.getByRole("button", { name: "解决", exact: true }).click();
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("resolved");
    const reopen = page.locator(".command-accordions details").filter({ hasText: "重开" });
    await reopen.locator("summary").click();
    await reopen.getByLabel("理由", { exact: true }).fill("New user-reviewed context requires the Issue to be reconsidered.");
    await reopen.getByRole("button", { name: "重开", exact: true }).click();
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("reopened");

    await page.getByRole("button", { name: "返回列表" }).click();
    await page.getByRole("button", { name: /Waive one bounded repeated audit/u }).click();
    const waive = page.locator(".command-accordions details").filter({ hasText: "豁免" });
    await waive.locator("summary").click();
    await waive.getByLabel("失效条件").fill("The audit becomes relevant if the current Brief or evidence boundary changes.");
    await waive.getByLabel("理由", { exact: true }).fill("Waive only this bounded duplicate audit.");
    await waive.getByRole("button", { name: "豁免", exact: true }).click();
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("waived");

    await page.getByRole("button", { name: "返回列表" }).click();
    await page.getByRole("button", { name: /Dispute an alleged argument leap/u }).click();
    const dispute = page.locator(".command-accordions details").filter({ hasText: "提出异议" });
    await dispute.locator("summary").click();
    await dispute.getByLabel("理由", { exact: true }).fill("The owner disputes this classification and preserves it in history.");
    await dispute.getByRole("button", { name: "提出异议", exact: true }).click();
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("disputed");

    await objectNav(page, "Evidence");
    await expect(page.locator(".ledger-list li")).toHaveCount(1);
    await page.getByRole("button", { name: /Canonical evidence for UI-02/u }).click();
    await expect(page.locator(".object-facts")).toContainText(fixture.artifactId);
    await expect(page.locator(".object-facts")).toContainText("descriptive");
    await expect(page.locator("body")).not.toContainText("disk-only-canary-ui02");

    await objectNav(page, "Episodes");
    await page.locator(".ledger-list li button").first().click();
    await expect(page.getByRole("heading", { name: `Episode ${fixture.episodeId}` })).toBeVisible();
    await expect(page.locator(".object-facts")).toContainText(fixture.originalTask);
    await expect(page.getByRole("heading", { name: "ArgumentDelta from related Receipts" })).toBeVisible();

    await page.getByLabel("项目内搜索").fill("canonical evidence");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator(".search-results")).toContainText("evidence · current · user_recorded:user");
    await page.locator(".search-results li button").filter({ hasText: "evidence · current" }).click();
    await expect(page.getByRole("heading", { name: fixture.evidenceSummary })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: `Episode ${fixture.episodeId}` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: `Episode ${fixture.episodeId}` })).toBeVisible();

    await objectNav(page, "Attention");
    await expect(page.locator(".attention-list")).toContainText("Resolve the evidence boundary");
    await expect(page.locator(".attention-list")).toContainText("reopen");

    await page.getByRole("button", { name: /Review Room/u }).click();
    await prepareAndAnalyze(page, provider);
    await page.getByLabel("你的处置理由").fill("The owner accepts this bounded, evidence-aware continuity increment.");
    await page.getByRole("button", { name: "接受", exact: true }).click();
    await expect(page.locator(".receipt-list li").first()).toContainText("committed");
    await page.getByRole("button", { name: "打开 Trace" }).click();
    await expect(page.locator("#object-title")).toContainText(/^Receipt /u);
    await expect(page.locator(".trace")).toContainText("用户可读因果 Trace");
    const downloadReady = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载凭证" }).click();
    const download = await downloadReady;
    const downloadPath = await download.path();
    expect(JSON.parse(await readFile(downloadPath, "utf8")) as { status?: string }).toMatchObject({ status: "committed" });
    await page.reload();
    await expect(page.locator(".trace")).toBeVisible();
    await page.getByLabel("回滚理由").fill("Restore the exact state before this accepted review.");
    await page.getByRole("button", { name: "确认回滚" }).click();
    await closeInspector(page);
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("rolled_back");
    await page.getByRole("button", { name: "返回列表" }).click();
    await expect(page.locator(".ledger-list li").first()).toContainText("rolled_back");
    expect(await page.locator(".ledger-list li").count()).toBeLessThanOrEqual(50);
  });

  test("keeps projects isolated and local ledgers usable without a Provider, then fails safely offline", async ({ page }) => {
    const projectA = await createUi02Project({ title: "Alpha Continuity", question: "How should Alpha preserve its unique continuity boundary?", uniqueToken: "alpha-disk-only-token", evidenceId: "revd_01ARZ3NDEKTSV4RRFFQ69G5FAW", evidenceSummary: "Canonical Alpha evidence for project isolation." });
    const projectB = await createUi02Project({ title: "Beta Continuity", question: "How should Beta preserve its independent continuity boundary?", uniqueToken: "beta-disk-only-token", evidenceId: "revd_01ARZ3NDEKTSV4RRFFQ69G5FAX", evidenceSummary: "Canonical Beta evidence for project isolation." });
    cleanups.push(() => projectA.cleanup(), () => projectB.cleanup());
    const server = await startRoom(page, [projectA, projectB]);

    await objectNav(page, "Research Brief");
    await page.getByRole("button", { name: "创建 candidate" }).click();
    await page.locator(".structured-editor textarea[name='currentTask']").fill("Unsaved Alpha draft must not cross projects.");
    await page.getByLabel("项目内搜索").fill("Alpha");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator(".search-results")).toContainText(projectA.projectId);
    await page.getByRole("button", { name: "切换研究项目" }).click();
    await expect(page.getByRole("heading", { name: "打开研究项目" })).toBeVisible();
    await page.getByRole("button", { name: "选择文件夹并打开" }).click();
    await expect(page.locator(".project-navigation")).toContainText("Beta Continuity");
    await expect(page.locator("body")).not.toContainText("Unsaved Alpha draft");
    await expect(page.getByLabel("项目内搜索")).toHaveValue("");

    await objectNav(page, "Evidence");
    await expect(page.locator(".ledger-list")).toContainText(projectB.evidenceSummary);
    await page.goto(`${server.origin}/project/evidence/${projectA.evidenceId}`);
    await expect(page.getByText("当前项目中没有这个对象。")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(projectA.evidenceSummary);
    await closeInspector(page);

    await page.getByLabel("项目内搜索").fill("Alpha");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator(".search-results")).toContainText("没有匹配的结构化对象");
    await expect(page.locator("body")).not.toContainText("alpha-disk-only-token");

    await page.getByRole("button", { name: /Review Room/u }).click();
    await prepareAndAnalyze(page);
    await expect(page.locator(".thread-event--analysis")).toContainText("ledger_only");
    await expect(page.getByRole("button", { name: "接受", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "拒绝", exact: true })).toBeEnabled();

    const serverIndex = servers.indexOf(server);
    if (serverIndex >= 0) servers.splice(serverIndex, 1);
    await server.close();
    await objectNav(page, "项目概览");
    await expect(page.locator(".live-region")).toContainText("本地 Research Room 不可用");
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toContainText("请确认本地服务正在运行");
  });

  test("rejects stale Brief activation without optimistic writes and contains one corrupt ledger", async ({ page }) => {
    const stale = await createUi02Project({ title: "Stale Command Workspace" }); cleanups.push(() => stale.cleanup());
    await startRoom(page, [stale]);
    await objectNav(page, "Research Brief");
    await page.getByRole("button", { name: "创建 candidate" }).click();
    const staleTask = "This stale candidate must not become active.";
    await page.locator(".structured-editor textarea[name='currentTask']").fill(staleTask);
    await page.getByLabel("Candidate 理由").fill("Exercise stale recovery without optimistic writes.");
    await page.getByRole("button", { name: "保存 pending candidate" }).click();
    await page.route("**/api/commands/brief/activate", async (route) => {
      const raw = route.request().postData();
      const body = raw === null ? {} : JSON.parse(raw) as Record<string, unknown>;
      const expectedVersion = typeof body.expectedVersion === "number" ? body.expectedVersion + 1 : 99;
      await route.continue({ postData: JSON.stringify({ ...body, expectedVersion }) });
    });
    await page.getByLabel("激活理由").fill("Attempt the stale command once.");
    await page.getByLabel(/我已核对字段 diff 与影响/u).check();
    await page.getByRole("button", { name: "激活 candidate" }).click();
    await expect(page.getByRole("status")).toContainText("页面依据的研究状态已经变化");
    await expect(page.locator(".brief-main-fields")).toContainText(stale.originalTask);
    await expect(page.locator(".brief-main-fields")).not.toContainText(staleTask);
    await closeInspector(page);
    await expect(page.locator(".candidate")).toContainText("pending");
    await expect(page.getByRole("button", { name: "重新加载当前版本" })).toBeEnabled();

    const corrupt = await createUi02Project({ title: "Corrupt Evidence Ledger Workspace" }); cleanups.push(() => corrupt.cleanup());
    const database = new DatabaseSync(join(corrupt.root, ".sestina", "state.sqlite"), { open: true });
    try {
      database.prepare("UPDATE argument_evidence SET data = ? WHERE project_id = ? AND evidence_id = ?").run("{}", corrupt.projectId, corrupt.evidenceId);
    } finally {
      database.close();
    }
    await page.getByRole("button", { name: "切换研究项目" }).click();
    const replacementServer = await createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(corrupt.root) }, languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN") }).start();
    servers.push(replacementServer);
    await page.goto(replacementServer.origin);
    await page.getByRole("button", { name: "选择文件夹并打开" }).click();
    await objectNav(page, "Research Brief");
    await expect(page.locator(".brief-main-fields")).toContainText(corrupt.question);
    await objectNav(page, "Evidence");
    await expect(page.getByRole("status")).toContainText("Sestina 无法读取或更新当前项目的本地研究状态");
    const safePageText = await page.locator("body").innerText();
    expect(safePageText).not.toContain(corrupt.root);
    expect(safePageText).not.toContain("state.sqlite");
    expect(safePageText).not.toContain("SQLITE");
    expect(safePageText).not.toContain("stack");
  });

  test("keeps a Receipt committed when rollback conflicts with a later Decision mutation", async ({ page }) => {
    const fixture = await createUi02Project({ title: "Rollback Conflict Workspace" }); cleanups.push(() => fixture.cleanup());
    const provider = new Ri48FixtureProvider("reasonable_increment");
    const server = await startRoom(page, [fixture], provider);
    await prepareAndAnalyze(page, provider);
    await page.getByLabel("你的处置理由").fill("Create a committed Receipt before a later canonical mutation.");
    await page.getByRole("button", { name: "接受", exact: true }).click();
    await expect(page.locator(".receipt-list li").first()).toContainText("committed");

    await page.goto(`${server.origin}/project/decisions/${fixture.acceptedDecisionId}`);
    await page.getByLabel("理由", { exact: true }).fill("Freeze this Decision after the Receipt to force rollback conflict detection.");
    await page.getByRole("button", { name: "冻结", exact: true }).click();
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("frozen");
    await objectNav(page, "Receipts");
    await page.locator(".ledger-list li button").first().click();
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("committed");
    await page.getByLabel("回滚理由").fill("Attempt rollback after a later canonical Decision mutation.");
    await page.getByRole("button", { name: "确认回滚" }).click();
    await expect(page.locator(".live-region")).toContainText("已停止回滚且没有形成部分写入");
    await closeInspector(page);
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("committed");
    await page.goto(`${server.origin}/project/decisions/${fixture.acceptedDecisionId}`);
    await expect(page.locator(".object-workspace > .status-badge")).toContainText("frozen");
  });

  test("keeps the newest object detail when an older request finishes late", async ({ page }) => {
    const fixture = await createUi02Project({ title: "UI-02 Request Ordering" }); cleanups.push(() => fixture.cleanup());
    await startRoom(page, [fixture]);
    let markOlderRequestStarted: (() => void) | undefined;
    let releaseOlderRequest: (() => void) | undefined;
    const olderRequestStarted = new Promise<void>((resolve) => { markOlderRequestStarted = resolve; });
    const olderRequestRelease = new Promise<void>((resolve) => { releaseOlderRequest = resolve; });
    await page.route(`**/api/project/issues/${fixture.resolveIssueId}`, async (route) => {
      const response = await route.fetch();
      markOlderRequestStarted?.();
      await olderRequestRelease;
      await route.fulfill({ response });
    });

    await navigateInApp(page, `/project/issues/${fixture.resolveIssueId}`);
    await olderRequestStarted;
    await navigateInApp(page, `/project/issues/${fixture.waiveIssueId}`);
    const newestHeading = page.getByRole("heading", { name: "Waive one bounded repeated audit with an explicit invalidation condition." });
    await expect(newestHeading).toBeVisible();

    releaseOlderRequest?.();
    await page.waitForTimeout(150);
    await expect(newestHeading).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/project/issues/${fixture.waiveIssueId}`);
  });

  test("visually verifies Light, Dark, vivid High Contrast, English, Chinese, keyboard focus, and 200 percent text", async ({ page }, testInfo) => {
    const fixture = await createUi02Project({ title: "UI-02 Visual Matrix" }); cleanups.push(() => fixture.cleanup());
    await startRoom(page, [fixture]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await objectNav(page, "项目概览");
    await chooseAppearance(page, "zh", "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await captureHealthyScreenshot(page, testInfo, "ui02-light-overview-zh-1280x800.png", 1280, 800);

    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project Overview" })).toBeVisible();
    await chooseAppearance(page, "en", "dark");
    await objectNav(page, "Decisions");
    await page.locator(".ledger-list li button").first().click();
    await captureHealthyScreenshot(page, testInfo, "ui02-dark-decision-en-1440x900.png", 1440, 900);

    await page.getByRole("button", { name: "中文", exact: true }).click();
    await chooseAppearance(page, "zh", "high_contrast", true);
    await objectNav(page, "Issues");
    await page.getByRole("button", { name: /Resolve the evidence boundary/u }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "high_contrast");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await expect(page.locator(".brand__mark")).toHaveCSS("background-color", "rgb(0, 229, 255)");
    await expect(page.locator(".brand__mark")).toHaveCSS("border-top-width", "3px");
    await captureHealthyScreenshot(page, testInfo, "ui02-vivid-high-contrast-issue-zh-1728x1117.png", 1728, 1117);

    await chooseAppearance(page, "zh", "light", true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route("**/assets/*.css", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\nhtml { font-size: 200% !important; }\n` });
    });
    await page.reload();
    await objectNav(page, "Research Brief");
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");
    const inspect = page.getByRole("button", { name: "检查来源" });
    await page.getByRole("button", { name: "创建 candidate" }).focus();
    await page.keyboard.press("Tab");
    await expect(inspect).toBeFocused();
    await expect(inspect).not.toHaveCSS("outline-style", "none");
    await page.keyboard.press("Enter");
    const inspector = page.getByRole("complementary", { name: "Context Inspector" });
    await expect(inspector.getByRole("button", { name: "关闭 Inspector" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(inspector.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(inspect).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await captureHealthyScreenshot(page, testInfo, "ui02-light-brief-zh-200pct-1280x800.png", 1280, 800);
  });
});
