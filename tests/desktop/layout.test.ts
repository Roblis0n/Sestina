import { it, expect } from "vitest";
import { _electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
it("keeps the narrow desktop task near its navigation and hides only the accessibility legend", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-desktop-layout-")), projectPath = join(root, "project"); await mkdir(projectPath);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const installed = process.env.SESTINA_TEST_INSTALLED_EXECUTABLE;
  const electron = await _electron.launch({ executablePath: installed ?? createRequire(resolve("apps/desktop/package.json"))("electron"), args: [...(installed ? [] : [resolve("apps/desktop")]), `--user-data-dir=${join(root, "profile")}`], env });
  try {
    const page = await electron.firstWindow(); await page.waitForFunction(() => Boolean((window as any).sestinaDesktop));
    await electron.evaluate(({ BrowserWindow, dialog }, path) => { BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 900); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, projectPath);
    await page.evaluate(async path => { const api = (window as any).sestinaDesktop.methods; await api.pickDirectory(); await api.createProject({ projectPath: path, title: "Synthetic empty project" }); await api.closeProject(); }, projectPath);
    await page.getByRole("button", { name: "选择文件夹", exact: true }).click();
    await page.getByRole("button", { name: "打开项目", exact: true }).click();
    await page.getByRole("heading", { name: "当前研究", exact: true }).waitFor();
    const gap = await page.evaluate(() => document.querySelector(".kernel-content")!.getBoundingClientRect().top - document.querySelector(".kernel-navigation")!.getBoundingClientRect().bottom);
    expect(gap).toBeLessThanOrEqual(64);
    await page.getByRole("button", { name: "新建审议", exact: true }).click();
    await page.getByLabel("新的建议", { exact: true }).fill("Synthetic visual check");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.getByRole("textbox", { name: "建议内容", exact: true }).waitFor();
    const legend = await page.locator(".review-access legend").boundingBox();
    expect(legend?.width).toBeLessThanOrEqual(1);
  } catch (error) { console.error(await electron.windows()[0]?.locator("body").innerText()); throw error; }
  finally { await electron.close(); await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
}, 60000);
