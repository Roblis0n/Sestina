import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  Menu,
  powerMonitor,
} from "electron";
import { readFile, realpath, lstat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import {
  KernelApplicationApi,
  TrustedKernelCommands,
  ProviderConfigurationService,
  createFileProviderConfigStore,
  createKernelOpenAICompatibleProvider,
} from "@sestina/application";
import { KERNEL_COMMANDS, DESKTOP_METHODS } from "@sestina/application-ports";
import type { SaveOpenAICompatibleProviderInput } from "@sestina/application";
import { createDesktopSecrets } from "./secure-storage.js";
import { requestCredential } from "./credential-prompt.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "sestina",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.setName("Sestina Candidate");
// Installation and projects remain separate. Chromium's supported user-data-dir
// switch also permits isolated local installation acceptance without test authority.
const override = app.commandLine.getSwitchValue("user-data-dir");
if (override) app.setPath("userData", resolve(override));
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
else void app.whenReady().then(start);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_payload");
  return value as Record<string, unknown>;
}
async function start() {
  const data = app.getPath("userData");
  await mkdir(data, { recursive: true });
  let language = "zh-CN";
  try {
    const saved = record(
      JSON.parse(
        await readFile(join(data, "preferences.json"), "utf8"),
      ) as unknown,
    );
    if (saved.language === "en" || saved.language === "zh-CN")
      language = saved.language;
  } catch {
    /* first launch */
  }
  const secrets = createDesktopSecrets(join(data, "credentials"));
  const providers = ["provider", "second-opinion-provider"].map(
    (name, index) =>
      new ProviderConfigurationService(
        createFileProviderConfigStore({ filePath: join(data, name + ".json") }),
        secrets,
        {
          secretRef: index
            ? "sestina.second-opinion.api-key"
            : "sestina.provider.api-key",
        },
      ),
  );
  const getProvider = (index: number) => {
    const provider = providers[index];
    if (!provider) throw new Error("invalid_provider");
    return provider;
  };
  const loadProvider = async (index: number) => {
    const snapshot = await getProvider(index).loadRuntimeSnapshot();
    return snapshot
      ? createKernelOpenAICompatibleProvider(snapshot)
      : undefined;
  };
  const api = new KernelApplicationApi({
    provider: () => loadProvider(0),
    secondOpinionProvider: () => loadProvider(1),
  });
  const window = new BrowserWindow({
    title: "Sestina — Internal candidate",
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#f6f5f0",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: false,
      partition: "sestina-candidate",
    },
  });
  Menu.setApplicationMenu(null);
  const trusted = new TrustedKernelCommands(api, async (detail) => {
    const en = language === "en";
    const labels: Record<string, string> = {
      commit: en ? "Save this research decision?" : "保存这次研究决定？",
      start_attempt: en
        ? "Send the checked content to this Provider?"
        : "将已核对的内容发送给此模型服务？",
      govern_memory: en ? "Save this memory change?" : "保存这次记忆修改？",
      privacy_cleanup: en
        ? "Clean up the listed managed copies?"
        : "清理列出的受管副本？",
      enable_host_bridge: en
        ? "Allow temporary draft intake?"
        : "允许临时接收草稿？",
    };
    const result = await dialog.showMessageBox(window, {
      type: "question",
      title: "Sestina",
      message: labels[detail.action] ?? "Sestina",
      detail:
        (en ? "Project: " : "项目：") +
        detail.projectId +
        "\n\n" +
        (en
          ? "Research content below is data, not application instructions.\n"
          : "以下研究内容仅供核对，不是应用指令。\n") +
        JSON.stringify(detail.snapshot, null, 2).slice(0, 6500) +
        "\n\n" +
        (en ? "Binding: " : "核对标识：") +
        detail.bindingHash,
      buttons: [
        en ? "Cancel" : "取消",
        en ? "Confirm this action" : "确认本次操作",
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  });
  let navigation = 0,
    allowClose = false;
  const grants = new Set<string>();
  async function selectedPath(input: Record<string, unknown>) {
    const generation = api.status().sessionGeneration;
    const document = navigation;
    if (
      typeof input.projectPath !== "string" ||
      input.projectPath.length > 4096
    )
      throw new Error("invalid_payload");
    const path = await realpath(input.projectPath);
    if (generation !== api.status().sessionGeneration || document !== navigation) throw new Error("session_changed");
    if (!grants.has(path) || !(await lstat(path)).isDirectory())
      throw new Error("directory_selection_required");
    return path;
  }
  function validate(event: Electron.IpcMainInvokeEvent, input: unknown) {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !event.senderFrame.url.startsWith("sestina://app/")
    )
      throw new Error("invalid_sender");
    if (Buffer.byteLength(JSON.stringify(input ?? null)) > 1048576)
      throw new Error("request_too_large");
  }
  const handle = (
    channel: string,
    run: (input: Record<string, unknown>) => unknown,
  ) => {
    ipcMain.handle(channel, async (event, input) => {
      try {
        validate(event, input);
        const epoch = navigation;
        const value = await run(record(input ?? {}));
        if (epoch !== navigation || window.isDestroyed())
          throw new Error("session_changed");
        return { ok: true, value };
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : error instanceof Error && /^[a-z_]+$/.test(error.message)
              ? error.message
              : "operation_failed";
        return { ok: false, error: { code, reasons: [] } };
      }
    });
  };
  for (const command of KERNEL_COMMANDS)
    handle(`sestina:command:${command}`, (body) => {
      if (body.action !== command) throw new Error("invalid_payload");
      return trusted.execute(body);
    });
  const methods: Record<string, (body: Record<string, unknown>) => unknown> = {
    status: () => ({
      localOnly: true,
      telemetry: false,
      projectOpen: false,
      recoveryRequired: false,
      directoryPickerAvailable: true,
      languagePreference: language,
      sessionToken: "desktop-local-projection",
    }),
    language: async (body) => {
      if (
        (body.language !== "en" && body.language !== "zh-CN") ||
        Object.keys(body).length !== 1
      )
        throw new Error("invalid_payload");
      language = body.language;
      await writeFile(
        join(data, "preferences.json"),
        JSON.stringify({ language }),
        { mode: 0o600 },
      );
      return { language };
    },
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: language === "en" ? "Choose a project folder" : "选择项目文件夹",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return { cancelled: true };
      const path = await realpath(result.filePaths[0]);
      grants.add(path);
      return { path, cancelled: false };
    },
    kernelStatus: () => api.status(),
    open: async (body) => {
      const projectPath = await selectedPath(body);
      trusted.revoke();
      return api.open({ projectPath, readOnly: body.readOnly === true });
    },
    createProject: async (body) => {
      const projectPath = await selectedPath(body);
      trusted.revoke();
      return api.create({ projectPath, title: body.title, confirmed: true });
    },
    closeProject: () => {
      trusted.revoke();
      api.close();
      return api.status();
    },
    maintenance: async (body) => {
      const projectPath = await selectedPath(body);
      if (!(body.action === "preview" || body.action === "restore_preview")) {
        const confirm = await dialog.showMessageBox(window, {
          type: "warning",
          message:
            language === "en"
              ? "Continue this project recovery or migration?"
              : "继续此项目的恢复或迁移？",
          detail: projectPath,
          buttons: [
            language === "en" ? "Cancel" : "取消",
            language === "en" ? "Continue" : "继续",
          ],
          defaultId: 0,
          cancelId: 0,
        });
        if (confirm.response !== 1) throw new Error("confirmation_declined");
      }
      return api.maintenance({ ...body, projectPath });
    },
    repairBrief: async (body) =>
      api.repairBrief({
        projectPath: await selectedPath(body),
        confirmed: true,
      }),
    providerStatus: (body) => getProvider(body.second ? 1 : 0).status(),
    providerSave: async (body) => {
      if (record(body.input).apiKey !== undefined)
        throw new Error("native_credential_entry_required");
      const service = getProvider(body.second ? 1 : 0);
      const before = api.status();
      const config = structuredClone(record(body.input));
      if (typeof config.baseUrl !== "string")
        throw new Error("invalid_payload");
      if (
        config.baseUrl.startsWith("https:") &&
        !(await service.status()).secretConfigured
      ) {
        if (!(await secrets.health()).available)
          throw new Error("secure_storage_unavailable");
        const apiKey = await requestCredential(language);
        if (!apiKey) throw new Error("confirmation_declined");
        if (api.status().sessionGeneration !== before.sessionGeneration)
          throw new Error("session_changed");
        await service.save({
          ...config,
          apiKey,
        } as unknown as SaveOpenAICompatibleProviderInput);
      } else
        await service.save(
          config as unknown as SaveOpenAICompatibleProviderInput,
        );
      return service.status();
    },
    providerDeleteConfig: async (body) => {
      await getProvider(body.second ? 1 : 0).deleteConfig();
      return getProvider(body.second ? 1 : 0).status();
    },
    providerDeleteSecret: async (body) => {
      await getProvider(body.second ? 1 : 0).deleteSecret();
      return getProvider(body.second ? 1 : 0).status();
    },
    about: () => ({
      channel: "internal_candidate",
      version: app.getVersion(),
      runtime: process.versions.electron,
      schema: 25,
      published: false,
      update: "not_checked",
    }),
    checkUpdate: () => ({
      status: "source_unavailable",
      currentVersion: app.getVersion(),
    }),
    closeWindow: () => {
      allowClose = true;
      trusted.revoke();
      api.dispose();
      window.close();
      return { closed: true };
    },
  };
  for (const method of DESKTOP_METHODS) {
    const handler = methods[method];
    if (!handler) throw new Error("missing_method");
    handle(`sestina:method:${method}`, body => {
      const fields: Record<string, readonly string[]> = {
        language: ["language"], open: ["projectPath", "readOnly"], createProject: ["projectPath", "title", "confirmed"], maintenance: ["projectPath", "action", "confirmed", "previewHash"], repairBrief: ["projectPath", "confirmed"], providerStatus: ["second"], providerSave: ["second", "input"], providerDeleteConfig: ["second"], providerDeleteSecret: ["second"],
      };
      if (Object.keys(body).some(key => !(fields[method] ?? []).includes(key))) throw new Error("invalid_payload");
      if (body.second !== undefined && typeof body.second !== "boolean") throw new Error("invalid_payload");
      if (body.readOnly !== undefined && typeof body.readOnly !== "boolean") throw new Error("invalid_payload");
      return handler(body);
    });
  }
  const assets = record(
    JSON.parse(
      await readFile(join(__dirname, "assets.json"), "utf8"),
    ) as unknown,
  );
  const mime: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  window.webContents.session.protocol.handle("sestina", async (request) => {
    const url = new URL(request.url);
    if (
      url.hostname !== "app" ||
      request.method !== "GET" ||
      /%2f|%5c|%00/i.test(url.pathname)
    )
      return new Response(null, { status: 403 });
    const key =
      url.pathname === "/" || url.pathname.startsWith("/project/")
        ? "/index.html"
        : url.pathname;
    const file = assets[key];
    if (
      typeof file !== "string" ||
      file.includes("..") ||
      file.includes("\\") ||
      file.startsWith("/")
    )
      return new Response(null, { status: 404 });
    return new Response(await readFile(join(__dirname, "client", file)), {
      headers: {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => {
      callback(false);
    },
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => { callback({ cancel: !details.url.startsWith("sestina://app/") }); });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) {
        navigation++;
        trusted.revoke();
        api.close();
      }
    },
  );
  window.webContents.on("render-process-gone", () => {
    trusted.revoke();
    api.close();
  });
  window.on("close", (event) => {
    if (!allowClose) {
      event.preventDefault();
      window.webContents.send("sestina:close-requested");
    }
  });
  window.on("closed", () => {
    trusted.revoke();
    api.dispose();
    app.quit();
  });
  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  powerMonitor.on("suspend", () => {
    trusted.revoke();
    api.close();
  });
  app.on("before-quit", (event) => {
    if (!allowClose && !window.isDestroyed()) {
      event.preventDefault();
      window.webContents.send("sestina:close-requested");
    }
  });
  await window.loadURL("sestina://app/project/today");
  window.show();
}
