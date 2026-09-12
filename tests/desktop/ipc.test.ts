import { it, expect } from "vitest";
import { _electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSecretBackend } from "../../packages/secrets/src/index.js";
import { OPENAI_COMPATIBLE_API_KEY_REF } from "../../packages/application/src/index.js";
it("real Electron IPC keeps renderer isolated, rejects forged inputs, and preserves a local draft", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-desktop-ipc-"));
  const projectPath = join(root, "合成项目 with spaces");
  await mkdir(projectPath);
  const requireDesktop = createRequire(resolve("apps/desktop/package.json"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === "win32") {
    env.LOCALAPPDATA = join(root, "legacy-appdata");
    const legacyRoot = join(env.LOCALAPPDATA, "Sestina");
    await mkdir(legacyRoot, { recursive: true });
    const secrets = createSecretBackend("win32", {
      windowsVaultPath: join(legacyRoot, "secrets", "vault.json"),
      envReader: { read: () => undefined, keys: () => [] },
    });
    await secrets.set(
      OPENAI_COMPATIBLE_API_KEY_REF,
      "synthetic-installed-migration-key",
    );
    await writeFile(
      join(legacyRoot, "provider.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        family: "openai_compatible",
        providerId: "synthetic",
        baseUrl: "https://provider.invalid",
        model: "synthetic",
        timeoutMs: 1000,
        locality: "external",
        generation: 7,
      }),
    );
  }
  const installedExecutable = process.env.SESTINA_TEST_INSTALLED_EXECUTABLE;
  const electron = await _electron.launch({
    executablePath: installedExecutable ?? requireDesktop("electron"),
    args: [
      ...(installedExecutable ? [] : [resolve("apps/desktop")]),
      `--user-data-dir=${join(root, "profile")}`,
    ],
    env,
    timeout: 30000,
  });
  try {
    const page = await electron.firstWindow();
    await electron.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.hide();
    });
    await page.waitForFunction(() => Boolean((window as any).sestinaDesktop));
    if (process.platform === "win32") {
      const migration = await page.evaluate(() =>
        window.sestinaDesktop!.methods.settingsMigration({ action: "migrate" }),
      );
      expect(migration.ok).toBe(true);
      expect((migration.value as any).providers[0].status).toBe("complete");
      const status = await page.evaluate(() =>
        window.sestinaDesktop!.methods.providerStatus(),
      );
      expect(status.ok && (status.value as any).secretConfigured).toBe(true);
      expect(
        await readFile(join(root, "profile", "provider.json"), "utf8"),
      ).not.toContain("synthetic-installed-migration-key");
      await page.evaluate(() =>
        window.sestinaDesktop!.methods.providerDeleteConfig(),
      );
    }
    expect(
      await page.evaluate(() => ({
        require: typeof (window as any).require,
        process: typeof (window as any).process,
        invoke: typeof (window as any).sestinaDesktop.invoke,
      })),
    ).toEqual({
      require: "undefined",
      process: "undefined",
      invoke: "undefined",
    });
    const security = await electron.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences(),
    );
    expect(security).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    });
    const otherSender = await electron.evaluate(
      async ({ BrowserWindow, app }) => {
        const foreign = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: `${app.getAppPath()}/dist/preload.cjs`,
            partition: "sestina-candidate",
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        try {
          await foreign.loadURL("sestina://app/project/today");
          return await foreign.webContents.executeJavaScript(
            "window.sestinaDesktop.methods.status()",
          );
        } finally {
          foreign.destroy();
        }
      },
    );
    expect(otherSender.error.code).toBe("invalid_sender");
    expect(
      await page.evaluate(() =>
        fetch("sestina://app/%2Fprivate-file").then(
          () => "unexpected_response",
          (error) => error.name,
        ),
      ),
    ).toBe("TypeError");
    expect(
      await electron.evaluate(
        async ({ BrowserWindow }) =>
          (
            await BrowserWindow.getAllWindows()[0]!.webContents.session.fetch(
              "sestina://app/%2Fprivate-file",
            )
          ).status,
      ),
    ).toBe(403);
    expect(
      await page.evaluate(
        () => window.open("https://synthetic.invalid/", "_blank") === null,
      ),
    ).toBe(true);
    expect(
      await electron.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    const invoke = (method: string, input: unknown = {}) =>
      page.evaluate(
        ({ method, input }) =>
          (window as any).sestinaDesktop.methods[method](input),
        { method, input },
      );
    expect((await invoke("open", { projectPath })).error.code).toBe(
      "directory_selection_required",
    );
    expect(
      (await invoke("status", { confirmed: true, actorId: "user" })).error.code,
    ).toBe("invalid_payload");
    // Simulates the OS picker result only; not counted as native UI acceptance.
    await electron.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, projectPath);
    await invoke("pickDirectory");
    const opened = await invoke("createProject", {
      projectPath,
      title: "Synthetic desktop IPC",
    });
    expect(opened.ok).toBe(true);
    let s = opened.value;
    const command = (action: string, body: object = {}) =>
      page.evaluate(
        (input) => (window as any).sestinaDesktop.commands[input.action](input),
        {
          projectId: s.projectId,
          sessionGeneration: s.sessionGeneration,
          action,
          ...body,
        },
      );
    const draft = await command("create", {
      suggestion: "Synthetic IPC draft 中文",
    });
    expect(draft.ok).toBe(true);
    const skipped = await command("skip_assessment", {
      reviewId: draft.value.id,
      expectedVersion: draft.value.version,
    });
    const prepared = await command("prepare_effect", {
      reviewId: draft.value.id,
      expectedVersion: skipped.value.version,
      payload: {
        kind: "record_only",
        outcome: "reference_only",
        reason: "Synthetic",
      },
    });
    await electron.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    const rejected = await command("commit", {
      reviewId: draft.value.id,
      expectedVersion: prepared.value.version,
      previewHash: prepared.value.effectDraft.previewHash,
      authorityCommandId: prepared.value.effectDraft.authorityCommandId,
      confirmed: true,
    });
    expect(rejected.error.code).toBe("confirmation_declined");
    await invoke("closeProject");
    expect(
      (
        await command("edit", {
          reviewId: draft.value.id,
          expectedVersion: prepared.value.version,
          suggestion: "old session",
        })
      ).ok,
    ).toBe(false);
    const reopened = await invoke("open", { projectPath });
    s = reopened.value;
    const read = await page.evaluate(
      (input) => (window as any).sestinaDesktop.commands.read(input),
      {
        projectId: reopened.value.projectId,
        sessionGeneration: reopened.value.sessionGeneration,
        action: "read",
        reviewId: draft.value.id,
      },
    );
    expect(read.value.review.suggestion).toBe("Synthetic IPC draft 中文");
    expect(read.value.review.status).toBe("manifest_confirmed");
    expect(read.value.review.terminalOutcome).toBeNull();
    expect(read.value.review.effectDraft.previewHash).toBe(
      prepared.value.effectDraft.previewHash,
    );
    // A renderer assertion must not authorize file repair, even on a valid selected folder.
    expect(
      (await invoke("repairBrief", { projectPath, confirmed: true })).error
        ?.code,
    ).toBe("confirmation_declined");
    const integration = await invoke("integration", {
      action: "config",
      projectId: reopened.value.projectId,
      sessionGeneration: reopened.value.sessionGeneration,
    });
    expect(integration.ok).toBe(true);
    const mcp = JSON.parse(integration.value.json).mcpServers.sestina;
    const requireMcp = createRequire(resolve("integrations/mcp/package.json"));
    const { Client } = await import(
      pathToFileURL(requireMcp.resolve("@modelcontextprotocol/client")).href
    );
    const { StdioClientTransport } = await import(
      pathToFileURL(requireMcp.resolve("@modelcontextprotocol/client/stdio"))
        .href
    );
    const client = new Client({
      name: "synthetic-installed-companion",
      version: "1.0.0",
    });
    const transport = new StdioClientTransport({
      ...mcp,
      cwd: root,
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((t: { name: string }) => t.name)).toContain(
        "get_research_context",
      );
      const context = await client.callTool({
        name: "get_research_context",
        arguments: {},
      });
      expect(context.structuredContent.error.code).toBe("no_active_brief");
      const review = await command("create", {
        suggestion: "Synthetic first Brief",
      });
      const skipped = await command("skip_assessment", {
        reviewId: review.value.id,
        expectedVersion: review.value.version,
      });
      const fields = {
        projectQuestion: "",
        currentTask: "Read the latest synthetic project snapshot",
        currentStage: "",
        targetArtifacts: [],
        fixedDecisions: [],
        allowedChanges: [],
        forbiddenChanges: [],
        expectedDeltas: [],
        evidenceBoundaries: [],
        explicitNonGoals: [],
      };
      const sections = Object.fromEntries(
        [
          ...Object.keys(fields),
          "knownUnknowns",
          "acceptedDecisions",
          "evidenceThresholds",
        ].map((key) => [
          key,
          { status: key === "currentTask" ? "provided" : "not_provided" },
        ]),
      );
      const prepared = await command("prepare_effect", {
        reviewId: review.value.id,
        expectedVersion: skipped.value.version,
        payload: {
          kind: "patch_brief",
          mode: "initialize",
          fields: {
            ...fields,
            progressive: {
              schemaVersion: "2.0.0",
              sections,
              knownUnknowns: [],
              acceptedDecisions: [],
              evidenceThresholds: [],
            },
          },
          reason: "Synthetic user task",
        },
      });
      expect(prepared.ok).toBe(true);
      await electron.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      const saved = await command("commit", {
        reviewId: review.value.id,
        expectedVersion: prepared.value.version,
        previewHash: prepared.value.effectDraft.previewHash,
        authorityCommandId: prepared.value.effectDraft.authorityCommandId,
      });
      expect(saved.ok).toBe(true);
      expect(
        (await client.callTool({ name: "get_research_context", arguments: {} }))
          .isError,
      ).not.toBe(true);
    } finally {
      await client.close();
    }
    await electron.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await invoke("closeProject");
    const closed = await invoke("kernelStatus");
    const maintenance = {
      projectPath,
      sessionGeneration: closed.value.sessionGeneration,
    };
    const backup = await invoke("maintenance", {
      ...maintenance,
      action: "backup",
    });
    expect(backup.ok).toBe(true);
    expect(backup.value.databaseSchemaVersion).toBe(25);
    const recovery = await invoke("maintenance", {
      ...maintenance,
      action: "backup_status",
    });
    expect(recovery.value.backups[0].valid).toBe(true);
    const preview = await invoke("maintenance", {
      ...maintenance,
      action: "backup_restore_preview",
      backupId: backup.value.backupId,
    });
    expect(preview.ok).toBe(true);
    const request = {
      ...maintenance,
      action: "backup_restore",
      backupId: backup.value.backupId,
      confirmationNonce: preview.value.confirmationNonce,
      expectedStateBinding: preview.value.stateBinding,
    };
    expect((await invoke("maintenance", request)).error?.code).toBe(
      "confirmation_declined",
    );
    await electron.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    expect((await invoke("maintenance", request)).ok).toBe(true);
    expect((await invoke("maintenance", request)).ok).toBe(false);
    expect((await invoke("open", { projectPath })).ok).toBe(true);
    await electron.evaluate(({ powerMonitor }) => powerMonitor.emit("suspend"));
    expect((await invoke("kernelStatus")).value.projectId).toBeNull();
    expect(
      (
        await invoke("integration", {
          action: "config",
          projectId: reopened.value.projectId,
          sessionGeneration: reopened.value.sessionGeneration,
        })
      ).ok,
    ).toBe(false);
  } finally {
    await electron.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 200,
    });
  }
}, 120000);

it("a crashed renderer cannot keep the application waiting for an unreachable close guard", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-desktop-crash-"));
  const requireDesktop = createRequire(resolve("apps/desktop/package.json"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const installed = process.env.SESTINA_TEST_INSTALLED_EXECUTABLE;
  const electron = await _electron.launch({
    executablePath: installed ?? requireDesktop("electron"),
    args: [
      ...(installed ? [] : [resolve("apps/desktop")]),
      `--user-data-dir=${root}`,
    ],
    env,
  });
  const child = electron.process();
  try {
    await electron.firstWindow();
    const closed = electron.waitForEvent("close", { timeout: 5000 });
    void closed.catch(() => {});
    await electron
      .evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer();
      })
      .catch(() => {});
    await expect(closed).resolves.toBeUndefined();
  } finally {
    child.kill();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 200,
    }).catch(() => {});
  }
}, 30000);
