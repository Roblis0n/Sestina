import { _electron, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { productionUiProject } from "../post-0.2/ui-factory.js";
import { migrateKernelProject } from "../../packages/core/src/index.js";

const executablePath = process.env.SESTINA_TEST_INSTALLED_EXECUTABLE;
if (!executablePath) throw new Error("installed_executable_required");
const output = resolve(
  process.env.SESTINA_DESKTOP_VISUAL_OUTPUT ?? ".tmp/g10-g11/installed-visual",
);
await mkdir(output, { recursive: true });
const records: object[] = [];
for (const language of ["en", "zh-CN"])
  for (const theme of ["light", "dark", "high_contrast"]) {
    const profile = await mkdtemp(join(tmpdir(), "sestina-installed-visual-"));
    await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
        format: "1.0.0",
        language,
        appearance: {
          version: 1,
          theme,
          reducedMotion: "system",
          reducedTransparency: true,
        },
        recentProjects: [],
      }),
    );
    const fixture = await productionUiProject("long");
    await migrateKernelProject({ projectRoot: fixture.root });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const electron = await _electron.launch({
      executablePath,
      args: [`--user-data-dir=${profile}`],
      env,
    });
    const child = electron.process();
    const en = language === "en",
      prefix = `${language}-${theme}`;
    const network: string[] = [];
    try {
      const identity = await electron.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        version: app.getVersion(),
        electron: process.versions.electron,
      }));
      if (!identity.packaged) throw new Error("installation_required");
      const page = await electron.firstWindow();
      page.setDefaultTimeout(10000);
      await page.waitForFunction(() => Boolean(window.sestinaDesktop));
      page.on("request", (request) => {
        if (!request.url().startsWith("sestina://app/"))
          network.push(request.url());
      });
      const size = async (width: number) => {
        await electron.evaluate(
          ({ BrowserWindow }, width) =>
            BrowserWindow.getAllWindows()[0]!.setContentSize(
              width,
              (
                { 1100: 760, 1280: 800, 1440: 900, 1920: 1080 } as Record<
                  number,
                  number
                >
              )[width]!,
            ),
          width,
        );
      };
      const shot = async (name: string) => {
        // DOM assertions can finish before Chromium presents the next frame.
        // Capture the settled real window, not the preceding screen's compositor surface.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await page.waitForTimeout(200);
        const png = await electron.evaluate(async ({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          const image = await window.capturePage(undefined, {
            stayAwake: true,
          });
          return image.toPNG().toString("base64");
        });
        await writeFile(
          join(output, `${prefix}-${name}.png`),
          Buffer.from(png, "base64"),
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      };
      const button = (name: string) =>
        page.getByRole("button", { name, exact: true });
      const link = (name: string) =>
        page.getByRole("link", { name, exact: true });
      await size(1100);
      await expect(
        page.getByRole("heading", {
          name: en ? "Open your research" : "打开研究项目",
          exact: true,
        }),
      ).toBeVisible();
      // Native selector/confirmation stubs are limited to this test process. They are not native-dialog acceptance.
      await electron.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      }, fixture.root);
      await button(en ? "Choose folder" : "选择文件夹").click();
      await page.locator(".desktop-recovery summary").click();
      await button(en ? "Create backup" : "创建备份").click();
      await expect(
        page.getByText(
          en ? "Backup created and verified." : "备份已创建并验证。",
          { exact: true },
        ),
      ).toBeVisible();
      await shot("backup-1100");
      await page.locator(".desktop-recovery summary").click();
      await page.locator(".desktop-settings-migration summary").click();
      await button(en ? "Show settings to copy" : "显示可复制的设置").click();
      const settings = page.getByRole("textbox", {
        name: en ? "Exported settings" : "导出的设置",
        exact: true,
      });
      const savedSettings = await settings.inputValue();
      await settings.fill("{invalid");
      await button(en ? "Import this settings text" : "导入此设置文本").click();
      await expect(settings).toHaveValue("{invalid");
      await shot("settings-import-error-1100");
      await settings.fill(savedSettings);
      await button(en ? "Import this settings text" : "导入此设置文本").click();
      await page.locator(".desktop-settings-migration summary").click();
      await button(en ? "Open project" : "打开项目").click();
      await expect(
        page.getByRole("heading", {
          name: en ? "Today / Review" : "今日 / 审议",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: en ? "Current research" : "当前研究",
          exact: true,
        }),
      ).toBeVisible();
      await shot("today-1100");
      await size(1280);
      await link(en ? "Project" : "项目").click();
      await expect(page.locator(".task-list li").first()).toBeVisible();
      await button(en ? "Research Brief" : "研究简报").click();
      await expect(
        page.locator(".project-brief-panel dl").first(),
      ).toBeVisible();
      await size(1440);
      await link(en ? "Search" : "搜索").click();
      await page
        .getByRole("searchbox", {
          name: en ? "Search research" : "搜索研究内容",
          exact: true,
        })
        .fill("Synthetic");
      await expect(page.locator(".task-list li").first()).toBeVisible();
      await size(1920);
      await link(en ? "Settings" : "设置").click();
      const configure = button(
        en ? "Configure assessment service" : "配置评估服务",
      );
      await configure.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: /API key|API 密钥/ }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(configure).toBeFocused();
      for (let i = 0; i < 3; i++) {
        await configure.click();
        await page.keyboard.press("Escape");
      }
      await expect(configure).toBeFocused();
      await button(en ? "About" : "关于").click();
      await button(en ? "Check for updates" : "检查更新").click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: en ? "trusted update source" : "可信更新源" }),
      ).toBeVisible();
      await shot("about-1920");
      await button(en ? "Integrations" : "集成").click();
      await page
        .getByText(
          en ? "Read-only MCP and companion Skills" : "只读 MCP 与配套 Skills",
          { exact: true },
        )
        .click();
      await button(
        en ? "Show configuration to copy" : "显示可复制的配置",
      ).click();
      await expect(
        page.getByRole("textbox", {
          name: en ? "MCP configuration (JSON)" : "MCP 配置（JSON）",
          exact: true,
        }),
      ).toHaveValue(/node\.exe/);
      await size(1280);
      await shot("integration-1280");
      await link(en ? "Today / Review" : "今日 / 审议").click();
      await button(en ? "New review" : "新建审议").click();
      await page
        .getByRole("textbox", {
          name: en ? "New suggestion" : "新的建议",
          exact: true,
        })
        .fill("Synthetic installed proposal 中文 <script>never run</script>");
      await button(en ? "Save draft" : "保存草稿").click();
      const suggestion = page.getByRole("textbox", {
        name: en ? "Suggestion" : "建议内容",
        exact: true,
      });
      await expect(suggestion).toBeVisible();
      await suggestion.fill("Unsaved installed text 中文");
      await link(en ? "Project" : "项目").click();
      await expect(
        button(en ? "Discard changes and leave" : "放弃修改并离开"),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(suggestion).toHaveValue("Unsaved installed text 中文");
      await button(en ? "Save draft" : "保存草稿").click();
      await size(1440);
      await shot("review-1440");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await size(1100);
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.activeElement?.tagName),
      ).not.toBe("BODY");
      await shot("review-200-percent-1100");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
      if (en && theme === "light") {
        await button("Continue without assessment").click();
        await page
          .getByRole("combobox", { name: "Research action", exact: true })
          .selectOption("create_decision");
        await page
          .getByRole("textbox", { name: "Specific result", exact: true })
          .fill("Synthetic installed saved decision");
        await page
          .getByRole("textbox", { name: "Reason", exact: true })
          .fill("Synthetic local decision without a Provider.");
        await button("View changes").click();
        await page
          .getByRole("checkbox", {
            name: "I confirm the changes shown above.",
            exact: true,
          })
          .check();
        await button("Confirm and save").click();
        await expect(
          page.getByRole("heading", { name: "Saved result", exact: true }),
        ).toBeVisible();
        await shot("saved-result-1100");
      }
      expect(network).toEqual([]);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await link(en ? "Settings" : "设置").click();
      await configure.click();
      await page.keyboard.press("Escape");
      await expect(configure).toBeFocused();
      records.push({
        language,
        theme,
        identity,
        sizes: [
          [1100, 760],
          [1280, 800],
          [1440, 900],
          [1920, 1080],
        ],
        text200Percent: true,
        noRendererNetwork: true,
        rapidDrawerCancellation: true,
        reducedMotion: true,
        backupAndPreferences: true,
        packagedIntegration: true,
        nativePickerAndConfirmation: "test_stubs_not_native_acceptance",
      });
      await page.evaluate(() => window.sestinaDesktop!.methods.closeProject());
    } catch (error) {
      console.error(`${prefix}: ${String(error)}`);
      throw error;
    } finally {
      const timer = setTimeout(() => child.kill(), 5000);
      await electron.close().catch(() => {});
      clearTimeout(timer);
      await fixture.cleanup();
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 4,
        retryDelay: 200,
      }).catch(() => {});
    }
  }
await writeFile(
  join(output, "results.json"),
  JSON.stringify({ passed: true, records }, null, 2),
);
console.log(
  JSON.stringify({ passed: true, scenarios: records.length, output }),
);
