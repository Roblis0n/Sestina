import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../../apps/research-room/src/language-preferences.js";
import { Ri48FixtureProvider } from "../helpers/ri48-project.js";
import { createUi02Project, type Ui02ProjectFixture } from "../helpers/ui02-project.js";
import { createRi51Project, type Ri51ProjectFixture } from "../helpers/ri51-project.js";

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

async function openProject(page: Page, fixture: Ui02ProjectFixture, provider?: Ri48FixtureProvider): Promise<RunningResearchRoomServer> {
  const server = await createResearchRoomServer({
    directoryPicker: { pick: () => Promise.resolve(fixture.root) },
    languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"),
    ...(provider ? { provider } : {}),
  }).start();
  servers.push(server);
  await page.goto(server.origin);
  await expect(page.getByRole("status")).toContainText("本地服务已就绪");
  await page.getByRole("button", { name: "选择文件夹并打开" }).click();
  await expect(page.getByRole("heading", { name: "Research Room" })).toBeVisible();
  return server;
}

async function openMemory(page: Page): Promise<void> {
  await page.locator(".object-nav-link").filter({ hasText: "恢复与记忆" }).click();
  await expect(page.getByRole("heading", { name: "使用受治理的项目记忆恢复研究" })).toBeVisible();
}

async function loadAllMemory(page: Page): Promise<void> {
  const loadMore = page.getByRole("button", { name: /加载更多记忆|Load more memory/u });
  for (let pageNumber = 0; pageNumber < 20 && await loadMore.count() > 0; pageNumber += 1) await loadMore.click();
  await expect(loadMore).toHaveCount(0);
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
  const png = await page.screenshot({ path: output, animations: "disabled" });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.byteLength).toBeGreaterThan(10_000);
}

function memoryItem(page: Page, text: string) {
  return page.locator(".memory-item").filter({ hasText: text }).first();
}

async function confirmMemoryItem(page: Page, text: string, reason: string): Promise<void> {
  const item = memoryItem(page, text);
  await item.getByRole("button", { name: "复核并确认" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("为什么执行这次操作？").fill(reason);
  await dialog.getByRole("button", { name: "确认操作" }).click();
  await expect(item).toHaveAttribute("data-state", "active");
}

test.describe("RI-51 governed project memory production flow", () => {
  test("starts empty and pins a canonical Decision only as a reviewable candidate", async ({ page }, testInfo) => {
    const fixture = await createUi02Project({ title: "RI-51 Empty and Pin Workspace" }); cleanups.push(() => fixture.cleanup());
    await openProject(page, fixture);
    await openMemory(page);

    await expect(page.getByRole("region", { name: "暂无项目工作记忆" })).toContainText("不会召回或发送");
    await expect(page.getByRole("heading", { name: "Project State（项目状态）" })).toBeVisible();
    await expect(page.locator(".memory-project-state").getByText(fixture.question, { exact: true })).toBeVisible();
    await capture(page, testInfo, "ri51-empty-zh-light-1440x900.png", 1440, 900);

    await page.locator(".object-nav-link").filter({ hasText: "研究决定" }).click();
    await page.locator(".ledger-list li button").first().click();
    await page.getByRole("button", { name: "固定到项目记忆" }).click();
    await expect(page.getByRole("region", { name: "把项目对象固定为候选" })).toContainText(fixture.acceptedDecisionId);
    const form = page.locator(".memory-create-form");
    await expect(form.getByLabel("类型")).toBeDisabled();
    await form.getByLabel("内容").fill("Resume by checking this frozen source binding before changing direction.");
    await form.getByLabel("公开操作理由").fill("Keep this canonical Decision visible as a non-authoritative recovery hint.");
    await form.getByRole("button", { name: "把项目对象固定为候选" }).click();
    const preview = page.getByRole("dialog");
    await expect(preview).toContainText(`decision · ${fixture.acceptedDecisionId}`);
    await expect(preview).toContainText("candidate");
    await preview.getByRole("button", { name: "创建 candidate" }).click();
    await expect(memoryItem(page, "Resume by checking this frozen source binding")).toContainText("candidate");
    await confirmMemoryItem(page, "Resume by checking this frozen source binding", "I reviewed the exact Decision source and want this hint recalled locally.");
  });

  test("completes create, confirm, edit, re-confirm, checkpoint, Search, Attention, restart, and irreversible forget", async ({ page }, testInfo) => {
    const fixture = await createRi51Project(); cleanups.push(() => fixture.cleanup());
    const server = await openProject(page, fixture);
    await openMemory(page);
    await expect(page.getByRole("button", { name: "加载更多记忆" })).toBeVisible();
    await loadAllMemory(page);

    for (const state of ["candidate", "active", "stale", "expired", "retired", "forgotten"]) await expect(page.getByRole("heading", { name: state, exact: true })).toBeVisible();
    await expect(memoryItem(page, fixture.eligibleSearchToken)).toContainText("explicit_manifest_only");
    await expect(memoryItem(page, "Pinned Decision source")).toContainText("source_version_changed");
    await expect(page.locator("body")).not.toContainText(fixture.forgottenSecret);
    await capture(page, testInfo, "ri51-states-zh-light-1440x900.png", 1440, 900);

    const createdText = "User-created lifecycle note for deterministic restart recovery.";
    const editedText = "Edited lifecycle note requires a second explicit confirmation before recall.";
    const form = page.locator(".memory-create-form");
    await form.getByLabel("内容").fill(createdText);
    await form.getByLabel("外发策略").selectOption("explicit_manifest_only");
    await form.getByLabel("公开操作理由").fill("Create one explicit candidate through the production UI.");
    await form.getByRole("button", { name: "预览候选" }).click();
    await expect(page.getByRole("dialog")).toContainText(createdText);
    await capture(page, testInfo, "ri51-candidate-preview-zh-light-1440x900.png", 1440, 900);
    await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).last().click();
    await expect(form.getByRole("button", { name: "预览候选" })).toBeFocused();
    await form.getByRole("button", { name: "预览候选" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "创建 candidate" }).click();
    await confirmMemoryItem(page, createdText, "I reviewed this candidate and explicitly enable project-local recall.");

    let item = memoryItem(page, createdText);
    await item.getByRole("button", { name: "编辑" }).click();
    let action = page.getByRole("dialog");
    await action.getByLabel("内容").fill(editedText);
    await action.getByLabel("为什么执行这次操作？").fill("Correct the recovery instruction; require confirmation again.");
    await action.getByRole("button", { name: "确认操作" }).click();
    await expect(memoryItem(page, editedText)).toContainText("candidate");
    await confirmMemoryItem(page, editedText, "I reviewed the edited version and explicitly confirm it again.");

    const inspectorTrigger = memoryItem(page, fixture.eligibleSearchToken).getByRole("button", { name: "查看来源与 Trace" });
    await inspectorTrigger.click();
    await expect(page.getByRole("complementary", { name: "Context Inspector" })).toContainText("semantic_conflict_unchecked");
    await page.keyboard.press("Escape");
    await expect(inspectorTrigger).toBeFocused();

    await page.getByRole("button", { name: "记录已复核检查点" }).click();
    await expect(page.locator(".resume-ledger")).toContainText("current");
    await page.reload();
    await expect(page.getByRole("heading", { name: "使用受治理的项目记忆恢复研究" })).toBeVisible();
    await loadAllMemory(page);
    await expect(memoryItem(page, editedText)).toContainText("active");

    await page.getByRole("button", { name: "搜索项目内容" }).click();
    await page.getByRole("searchbox", { name: "项目内搜索" }).fill(fixture.eligibleSearchToken);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const searchResult = page.getByRole("region", { name: "搜索结果" }).getByRole("button").filter({ hasText: "Governed recovery boundary" });
    await expect(searchResult).toContainText("memory");
    await searchResult.click();
    await expect(memoryItem(page, fixture.eligibleSearchToken)).toBeFocused();

    await page.locator(".object-nav-link").filter({ hasText: "待处理" }).click();
    const candidateAttention = page.locator(".attention-list li button").filter({ hasText: "Candidate awaiting" }).first();
    await expect(candidateAttention).toContainText("memory");
    await candidateAttention.click();
    await expect(memoryItem(page, "Candidate awaiting")).toBeFocused();

    const serverIndex = servers.indexOf(server); if (serverIndex >= 0) servers.splice(serverIndex, 1);
    await server.close();
    await openProject(page, fixture);
    await openMemory(page);
    await loadAllMemory(page);
    await expect(memoryItem(page, editedText)).toContainText("active");
    await expect(page.locator(".resume-ledger")).toBeVisible();

    item = memoryItem(page, editedText);
    await item.getByRole("button", { name: "不可逆遗忘" }).click();
    action = page.getByRole("dialog");
    await expect(action).toContainText("旧备份");
    await action.getByLabel("输入 FORGET").fill("FORGET");
    await action.getByRole("button", { name: "确认操作" }).click();
    await expect(page.locator("body")).not.toContainText(editedText);
    await expect(page.locator(".memory-state-group").filter({ hasText: "forgotten" })).toContainText("旧备份或手工导出");
  });

  test("keeps outbound zero by default and confirms the exact request-scoped payload with and without a configured Provider", async ({ page }, testInfo) => {
    const fixture = await createRi51Project(); cleanups.push(() => fixture.cleanup());
    await openProject(page, fixture);
    await openMemory(page);
    await loadAllMemory(page);

    await page.getByRole("button", { name: "预览精确 Manifest" }).click();
    let preview = page.locator(".memory-manifest-preview");
    await expect(preview).toContainText("包含 · 0");
    await expect(preview).toContainText("ledger_only");
    await preview.locator("details summary").click();
    await expect(preview.locator("pre")).toContainText('"items": []');
    await page.getByRole("button", { name: "重新生成预览" }).click();

    const eligible = page.locator(".memory-manifest-selection label").filter({ hasText: "Governed recovery boundary" });
    await eligible.getByRole("checkbox").check();
    const neverSend = page.locator(".memory-manifest-selection label").filter({ hasText: "Secret local continuity note" });
    await expect(neverSend.getByRole("checkbox")).toBeDisabled();
    const stale = page.locator(".memory-manifest-selection label").filter({ hasText: "Pinned Decision source" });
    await expect(stale.getByRole("checkbox")).toBeDisabled();
    await page.getByRole("button", { name: "预览精确 Manifest" }).click();
    preview = page.locator(".memory-manifest-preview");
    await expect(preview).toContainText("包含 · 1");
    await expect(preview).toContainText("candidate_not_confirmed");
    await expect(preview).toContainText("stale_source");
    await expect(preview).toContainText("expired");
    await expect(preview).toContainText("never_send");
    await preview.locator("details summary").click();
    const payloadBefore = await preview.locator("pre").innerText();
    expect(payloadBefore).toContain(fixture.eligibleSearchToken);
    await capture(page, testInfo, "ri51-manifest-no-provider-zh-light-1280x800.png", 1280, 800);
    await preview.getByRole("button", { name: "确认这一份精确选择" }).click();
    await expect(preview).toHaveAttribute("data-status", "confirmed");
    await expect(preview.locator("pre")).toHaveText(payloadBefore);

    const current = servers.pop(); if (current) await current.close();
    const provider = new Ri48FixtureProvider();
    await openProject(page, fixture, provider);
    await openMemory(page);
    await loadAllMemory(page);
    await expect(page.getByRole("region", { name: "当前研究线" })).toContainText("semantic_ready");
    await page.locator(".memory-manifest-selection label").filter({ hasText: "Governed recovery boundary" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "预览精确 Manifest" }).click();
    preview = page.locator(".memory-manifest-preview");
    await expect(preview).toContainText(provider.id);
    await expect(preview).not.toContainText("ledger_only");
    await capture(page, testInfo, "ri51-manifest-configured-fixture-zh-light-1440x900.png", 1440, 900);
    await preview.getByRole("button", { name: "确认这一份精确选择" }).click();
    await preview.getByRole("button", { name: "在 Review 中使用此选择" }).click();
    await expect(page).toHaveURL(/\/project\/review\?memory=/u);
    const selectedMemory = page.locator(".review-memory-options label").filter({ hasText: "Governed recovery boundary" });
    await expect(selectedMemory.getByRole("checkbox")).toBeChecked();
    await page.getByLabel("单个建议").fill("Add one bounded uncertainty statement while preserving the current project Authority boundary.");
    await page.getByRole("button", { name: "先生成 Context Manifest" }).click();
    const reviewManifest = page.locator(".thread-event--manifest");
    await expect(reviewManifest).toContainText("工作记忆");
    await expect(reviewManifest).toContainText("1 项包含");
    await capture(page, testInfo, "ri51-review-memory-manifest-configured-fixture-zh-light-1440x900.png", 1440, 900);
    await reviewManifest.getByRole("button", { name: "我已核对，开始分析" }).click();
    expect(provider.calls).toBe(1);
    expect(provider.lastRequest?.context.workingMemory?.items).toEqual([
      expect.objectContaining({ content: expect.objectContaining({ definition: expect.stringContaining(fixture.eligibleSearchToken) }) }),
    ]);
  });

  test("holds the same workflow across desktop widths, themes, languages, 200 percent text, and reduced preferences", async ({ page }, testInfo) => {
    const fixture: Ri51ProjectFixture = await createRi51Project(); cleanups.push(() => fixture.cleanup());
    await openProject(page, fixture);
    await openMemory(page);
    await loadAllMemory(page);

    await capture(page, testInfo, "ri51-light-zh-1920x1080.png", 1920, 1080);
    await page.getByRole("button", { name: "外观" }).click();
    await page.getByRole("radio", { name: "深色" }).check();
    await page.getByRole("group", { name: "减少动态" }).getByRole("radio", { name: "开启" }).check();
    await page.getByRole("checkbox", { name: "减少透明" }).check();
    await page.getByRole("button", { name: "应用外观" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resume with governed project memory" })).toBeVisible();
    await capture(page, testInfo, "ri51-dark-en-reduced-1728x1000.png", 1728, 1000);

    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "High contrast" }).check();
    await page.getByRole("button", { name: "Apply appearance" }).click();
    await page.evaluate('document.documentElement.style.setProperty("font-size", "200%", "important")');
    await expect(page.locator("html")).toHaveAttribute("data-theme", "high_contrast");
    await capture(page, testInfo, "ri51-high-contrast-en-200pct-1100x800.png", 1100, 800);
    await page.evaluate('document.documentElement.style.removeProperty("font-size")');

    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Light" }).check();
    await page.getByRole("button", { name: "Apply appearance" }).click();
    await capture(page, testInfo, "ri51-light-en-1280x900.png", 1280, 900);
    await capture(page, testInfo, "ri51-light-en-1440x900.png", 1440, 900);

    const longItem = memoryItem(page, fixture.eligibleSearchToken);
    await longItem.scrollIntoViewIfNeeded();
    await expect(longItem).toBeVisible();
    await expect(longItem.locator(".memory-body")).toHaveCSS("overflow-wrap", "anywhere");
    await capture(page, testInfo, "ri51-long-content-en-1728x1000.png", 1728, 1000);
  });
});
