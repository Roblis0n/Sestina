import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../../apps/research-room/src/server.js";
import { createRi48Project, Ri48FixtureProvider } from "../helpers/ri48-project.js";

type Scenario = "reasonable-increment" | "target-substitution" | "repeated-audit";
interface ScenarioFixture { readonly suggestion: string; readonly evidenceClass: "synthetic_fixture" | "synthetic_adversarial_fixture"; readonly expected: { readonly findingKind: string } }

const servers: RunningResearchRoomServer[] = [];
const cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => { while (servers.length) await servers.pop()?.close(); while (cleanups.length) await cleanups.pop()?.(); });

async function scenario(name: Scenario): Promise<ScenarioFixture> {
  return JSON.parse(await readFile(resolve(import.meta.dirname, `../fixtures/ri48/${name}.json`), "utf8")) as ScenarioFixture;
}

async function openRoom(page: Page, provider: Ri48FixtureProvider) {
  const fixture = await createRi48Project(); cleanups.push(() => fixture.cleanup());
  const server = await createResearchRoomServer({ provider }).start(); servers.push(server);
  await page.goto(server.origin);
  await expect(page.getByRole("status")).toContainText("本地服务已就绪");
  await page.getByLabel("项目目录").fill(fixture.root);
  await page.getByRole("button", { name: "打开所选项目" }).click();
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
  expect(provider.calls).toBe(0);
  await page.getByRole("button", { name: "我已核对，开始分析" }).click();
  await expect(page.getByText(new RegExp(fixture.expected.findingKind, "u"))).toBeVisible();
  expect(provider.calls).toBe(1);
}

test.describe("RI-48 real browser vertical slice", () => {
  test("reasonable increment: Manifest first, owner accepts, complete receipt persists", async ({ page }) => {
    const fixture = await scenario("reasonable-increment"); const provider = new Ri48FixtureProvider("reasonable_increment");
    await openRoom(page, provider); await prepareAndAnalyze(page, fixture, provider);
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
    await expect(page.getByText(/No traceable mechanism relation is added/u)).toBeVisible();
    await page.getByLabel("你的处置理由").fill("The owner rejects a repeated audit that adds no mechanism relation.");
    await page.getByRole("button", { name: "拒绝" }).click();
    await expect(page.getByText("rejected · committed", { exact: true })).toBeVisible();
  });
});
