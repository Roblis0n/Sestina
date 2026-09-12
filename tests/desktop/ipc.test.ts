import { it, expect } from "vitest";
import { _electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
it("real Electron IPC keeps renderer isolated, rejects forged inputs, and preserves a local draft", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-desktop-ipc-"));
  const projectPath = join(root, "project"); await mkdir(projectPath);
  const requireDesktop = createRequire(resolve("apps/desktop/package.json"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const electron = await _electron.launch({ executablePath: requireDesktop("electron"), args: [resolve("apps/desktop"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 30000 });
  try {
    const page = await electron.firstWindow();
    await electron.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide(); });
    await page.waitForFunction(() => Boolean((window as any).sestinaDesktop));
    expect(await page.evaluate(() => ({ require: typeof (window as any).require, process: typeof (window as any).process, invoke: typeof (window as any).sestinaDesktop.invoke }))).toEqual({ require: "undefined", process: "undefined", invoke: "undefined" });
    const security = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences());
    expect(security).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
    const invoke = (method: string, input: unknown = {}) => page.evaluate(({ method, input }) => (window as any).sestinaDesktop.methods[method](input), { method, input });
    expect((await invoke("open", { projectPath })).error.code).toBe("directory_selection_required");
    expect((await invoke("status", { confirmed: true, actorId: "user" })).error.code).toBe("invalid_payload");
    // Simulates the OS picker result only; not counted as native UI acceptance.
    await electron.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, projectPath);
    await invoke("pickDirectory");
    const opened = await invoke("createProject", { projectPath, title: "Synthetic desktop IPC" }); expect(opened.ok).toBe(true);
    const s = opened.value;
    const command = (action: string, body: object = {}) => page.evaluate(input => (window as any).sestinaDesktop.commands[input.action](input), { projectId: s.projectId, sessionGeneration: s.sessionGeneration, action, ...body });
    const draft = await command("create", { suggestion: "Synthetic IPC draft 中文" }); expect(draft.ok).toBe(true);
    const skipped = await command("skip_assessment", { reviewId: draft.value.id, expectedVersion: draft.value.version });
    const prepared = await command("prepare_effect", { reviewId: draft.value.id, expectedVersion: skipped.value.version, payload: { kind: "record_only", outcome: "reference_only", reason: "Synthetic" } });
    await electron.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    const rejected = await command("commit", { reviewId: draft.value.id, expectedVersion: prepared.value.version, previewHash: prepared.value.effectDraft.previewHash, authorityCommandId: prepared.value.effectDraft.authorityCommandId, confirmed: true });
    expect(rejected.error.code).toBe("confirmation_declined");
    await invoke("closeProject");
    expect((await command("edit", { reviewId: draft.value.id, expectedVersion: prepared.value.version, suggestion: "old session" })).ok).toBe(false);
    const reopened = await invoke("open", { projectPath });
    const read = await page.evaluate(input => (window as any).sestinaDesktop.commands.read(input), { projectId: reopened.value.projectId, sessionGeneration: reopened.value.sessionGeneration, action: "read", reviewId: draft.value.id });
    expect(read.value.review.suggestion).toBe("Synthetic IPC draft 中文");
    expect(read.value.review.status).toBe("manifest_confirmed");
    expect(read.value.review.terminalOutcome).toBeNull();
    expect(read.value.review.effectDraft.previewHash).toBe(prepared.value.effectDraft.previewHash);
  } finally { await electron.close(); await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
}, 120000);
