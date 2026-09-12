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
import { confirmationCopy } from "./native-copy.js";

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
    icon: join(__dirname, "client/sestina-logo.png"),
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
    const result = await dialog.showMessageBox(window, {
      type: "question",
      title: "Sestina",
      ...confirmationCopy(detail, language),
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  });
  let navigation = 0,
    allowClose = false;
  const credentialRequests = new Set<AbortController>();
  function closeResources() {
    for (const request of credentialRequests) request.abort();
    credentialRequests.clear();
    trusted.revoke();
    api.close();
  }
  const grants = new Set<string>();
  let fileConfirmationPending = false;
  async function confirmFileChange(projectPath: string, repair = false) {
    if (fileConfirmationPending) throw new Error("confirmation_in_progress");
    const epoch = navigation,
      generation = api.status().sessionGeneration;
    const expires = Date.now() + 60000;
    fileConfirmationPending = true;
    try {
      const en = language === "en";
      const result = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Sestina",
        message: repair
          ? en
            ? "Restore the missing Brief from verified project data?"
            : "从已验证的项目数据恢复缺失的 Brief？"
          : en
            ? "Apply the checked recovery or migration?"
            : "应用已核对的恢复或迁移？",
        detail:
          (en ? "Project folder: " : "项目文件夹：") +
          projectPath +
          "\n\n" +
          (en
            ? "The project service will verify the source again before changing files. If it has changed, this action will stop."
            : "项目服务会在修改文件前再次核对来源。来源已变化时，操作会停止。"),
        buttons: [
          en ? "Cancel" : "取消",
          repair
            ? en
              ? "Restore Brief"
              : "恢复 Brief"
            : en
              ? "Apply checked change"
              : "应用已核对的修改",
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1) throw new Error("confirmation_declined");
      if (
        window.isDestroyed() ||
        navigation !== epoch ||
        api.status().sessionGeneration !== generation ||
        Date.now() >= expires
      )
        throw new Error("confirmation_expired");
    } finally {
      fileConfirmationPending = false;
    }
  }
  async function selectedPath(input: Record<string, unknown>) {
    const generation = api.status().sessionGeneration;
    const document = navigation;
    if (
      typeof input.projectPath !== "string" ||
      input.projectPath.length > 4096
    )
      throw new Error("invalid_payload");
    const path = await realpath(input.projectPath);
    if (
      generation !== api.status().sessionGeneration ||
      document !== navigation
    )
      throw new Error("session_changed");
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
      closeResources();
      return api.open({ projectPath, readOnly: body.readOnly === true });
    },
    createProject: async (body) => {
      const projectPath = await selectedPath(body);
      closeResources();
      return api.create({ projectPath, title: body.title, confirmed: true });
    },
    closeProject: () => {
      closeResources();
      return api.status();
    },
    maintenance: async (body) => {
      const projectPath = await selectedPath(body);
      if (
        ![
          "preview",
          "restore_preview",
          "migrate",
          "restore",
          "recover",
        ].includes(String(body.action))
      )
        throw new Error("invalid_payload");
      if (!(body.action === "preview" || body.action === "restore_preview")) {
        await confirmFileChange(projectPath);
      }
      return api.maintenance({ ...body, projectPath, confirmed: true });
    },
    repairBrief: async (body) => {
      const projectPath = await selectedPath(body);
      await confirmFileChange(projectPath, true);
      return api.repairBrief({ projectPath, confirmed: true });
    },
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
        const cancellation = new AbortController();
        credentialRequests.add(cancellation);
        let apiKey: string | undefined;
        try {
          apiKey = await requestCredential(language, cancellation.signal);
        } finally {
          credentialRequests.delete(cancellation);
        }
        if (cancellation.signal.aborted) throw new Error("session_changed");
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
      closeResources();
      api.dispose();
      window.close();
      return { closed: true };
    },
  };
  for (const method of DESKTOP_METHODS) {
    const handler = methods[method];
    if (!handler) throw new Error("missing_method");
    handle(`sestina:method:${method}`, (body) => {
      const fields: Record<string, readonly string[]> = {
        language: ["language"],
        open: ["projectPath", "readOnly"],
        createProject: ["projectPath", "title", "confirmed"],
        maintenance: ["projectPath", "action", "confirmed", "previewHash"],
        repairBrief: ["projectPath", "confirmed"],
        providerStatus: ["second"],
        providerSave: ["second", "input"],
        providerDeleteConfig: ["second"],
        providerDeleteSecret: ["second"],
      };
      if (
        Object.keys(body).some((key) => !(fields[method] ?? []).includes(key))
      )
        throw new Error("invalid_payload");
      if (body.second !== undefined && typeof body.second !== "boolean")
        throw new Error("invalid_payload");
      if (body.readOnly !== undefined && typeof body.readOnly !== "boolean")
        throw new Error("invalid_payload");
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
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith("sestina://app/") });
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) {
        navigation++;
        closeResources();
      }
    },
  );
  window.webContents.on("render-process-gone", () => {
    closeResources();
    allowClose = true;
    window.destroy();
  });
  window.on("close", (event) => {
    if (!allowClose) {
      event.preventDefault();
      window.webContents.send("sestina:close-requested");
    }
  });
  window.on("closed", () => {
    closeResources();
    api.dispose();
    app.quit();
  });
  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  powerMonitor.on("suspend", () => {
    closeResources();
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
