import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  Menu,
  powerMonitor,
  shell,
} from "electron";
import { readFile, realpath, lstat, mkdir, chmod } from "node:fs/promises";
import { join, resolve, extname, dirname, basename, relative } from "node:path";
import { spawn } from "node:child_process";
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
import { DesktopUpdater } from "./updater.js";
import {
  TRUSTED_UPDATE_ROOTS,
  type InstalledUpdateIdentity,
} from "./update-policy.js";
import {
  preserveInstalledProgram,
  verifyPreservedProgram,
} from "./runtime-copy.js";
import {
  DesktopPreferenceStore,
  parseDesktopPreferences,
} from "./preferences.js";
import { LegacySettingsMigration } from "./legacy-settings.js";
import { withSessionSecrets } from "./session-secrets.js";
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
  const preferences = new DesktopPreferenceStore(data);
  let language =
    (await preferences.read().catch(() => undefined))?.language ?? "zh-CN";
  const secretSession = withSessionSecrets(
    createDesktopSecrets(join(data, "credentials")),
  );
  const secrets = secretSession.backend;
  const migration = new LegacySettingsMigration(
    data,
    secretSession.persistent,
    preferences,
  );
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
    exclusiveLease: true,
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
  let activeProjectPath: string | undefined;
  const credentialRequests = new Set<AbortController>();
  function closeResources() {
    secretSession.clear();
    for (const request of credentialRequests) request.abort();
    credentialRequests.clear();
    trusted.revoke();
    api.close();
  }
  const grants = new Set<string>();
  const installed = await readFile(join(__dirname, "identity.json"), "utf8")
    .then((value) => record(JSON.parse(value)))
    .catch(() => undefined);
  const current: InstalledUpdateIdentity = {
    version: app.getVersion(),
    channel: "internal_candidate",
    sequence: Number(installed?.sequence ?? 0),
    platform: process.platform,
    arch: process.arch,
    schema: 25,
    sourceCommit:
      typeof installed?.sourceCommit === "string"
        ? installed.sourceCommit
        : "0".repeat(40),
    migrationSourceSha256:
      typeof installed?.migrationSourceSha256 === "string"
        ? installed.migrationSourceSha256
        : "0".repeat(64),
  };
  const runtimeRoot =
    process.platform === "darwin"
      ? resolve(process.execPath, "../../..")
      : dirname(process.execPath);
  const rollbackRoot = join(data, "updates", "rollback");
  const launch = (path: string, args: string[] = []) =>
    new Promise<void>((resolveLaunch, reject) => {
      const child = spawn(path, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolveLaunch();
      });
    });
  const updater = new DesktopUpdater({
    directory: join(data, "updates"),
    current,
    roots: TRUSTED_UPDATE_ROOTS,
    // An authorized source is a build-time setting. No renderer, environment,
    // project file or test flag can install a signing root or an update URL.
    beforeInstall: async () => {
      if (api.maintaining || credentialRequests.size)
        throw Error("update_project_busy");
      const projectPath = activeProjectPath;
      closeResources();
      activeProjectPath = undefined;
      window.webContents.send("sestina:session-closed");
      if (!projectPath) return {};
      const backup = (await api.maintenance({
        action: "pre_upgrade_backup",
        projectPath,
        sessionGeneration: api.status().sessionGeneration,
      })) as { backupId: string };
      return { backupId: backup.backupId, projectPath };
    },
    preserveProgram: async () => {
      if (!app.isPackaged || !installed)
        throw Error("update_installation_required");
      return preserveInstalledProgram(
        runtimeRoot,
        rollbackRoot,
        current.sourceCommit,
      );
    },
    launchInstaller: async (path) => {
      if (process.platform === "win32") await launch(path);
      else if (process.platform === "linux") {
        await chmod(path, 0o700);
        await launch(path, [`--user-data-dir=${data}`]);
      } else {
        const failure = await shell.openPath(path);
        if (failure) throw Error("update_installer_failed");
      }
      allowClose = true;
      closeResources();
      api.dispose();
      app.quit();
    },
    restoreProgram: async (id) => {
      const preserved = await verifyPreservedProgram(rollbackRoot, id);
      const executable = join(
        preserved,
        relative(runtimeRoot, process.execPath),
      );
      if (basename(executable) !== basename(process.execPath))
        throw Error("update_rollback_invalid");
      app.relaunch({ execPath: executable, args: [`--user-data-dir=${data}`] });
      allowClose = true;
      closeResources();
      app.quit();
    },
  });
  await updater.initialize();
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
      await preferences.update({ language });
      return { language };
    },
    pickDirectory: async (body) => {
      const epoch = navigation,
        generation = api.status().sessionGeneration;
      const result = await dialog.showOpenDialog(window, {
        title: language === "en" ? "Choose a project folder" : "选择项目文件夹",
        properties: ["openDirectory", "createDirectory"],
        ...(typeof body.initialPath === "string" &&
        body.initialPath.length <= 4096
          ? { defaultPath: body.initialPath }
          : {}),
      });
      if (result.canceled || !result.filePaths[0]) return { cancelled: true };
      const path = await realpath(result.filePaths[0]);
      if (
        window.isDestroyed() ||
        epoch !== navigation ||
        generation !== api.status().sessionGeneration
      )
        throw new Error("session_changed");
      grants.add(path);
      return { path, cancelled: false };
    },
    kernelStatus: () => api.status(),
    open: async (body) => {
      if (updater.busy || api.maintaining)
        throw Error("maintenance_in_progress");
      const projectPath = await selectedPath(body);
      closeResources();
      const opened = await api.open({
        projectPath,
        readOnly: body.readOnly === true,
      });
      activeProjectPath = projectPath;
      return opened;
    },
    createProject: async (body) => {
      if (updater.busy || api.maintaining)
        throw Error("maintenance_in_progress");
      const projectPath = await selectedPath(body);
      closeResources();
      const opened = await api.create({
        projectPath,
        title: body.title,
        confirmed: true,
      });
      activeProjectPath = projectPath;
      return opened;
    },
    closeProject: () => {
      if (api.maintaining) throw Error("maintenance_in_progress");
      closeResources();
      activeProjectPath = undefined;
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
          "backup",
          "pre_upgrade_backup",
          "backup_status",
          "backup_restore_preview",
          "backup_restore",
          "backup_recover",
        ].includes(String(body.action))
      )
        throw new Error("invalid_payload");
      if (
        ![
          "preview",
          "restore_preview",
          "backup",
          "pre_upgrade_backup",
          "backup_status",
          "backup_restore_preview",
        ].includes(String(body.action))
      ) {
        await confirmFileChange(projectPath);
      }
      return api.maintenance({ ...body, projectPath, confirmed: true });
    },
    showBackupDirectory: async (body) => {
      const projectPath = await selectedPath(body);
      await api.maintenance({
        projectPath,
        sessionGeneration: body.sessionGeneration,
        action: "backup_status",
      });
      const directory = join(projectPath, ".sestina", "backups", "manual");
      for (const path of [
        join(projectPath, ".sestina"),
        join(projectPath, ".sestina", "backups"),
        directory,
      ]) {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("invalid_payload");
      }
      const failure = await shell.openPath(directory);
      if (failure) throw new Error("operation_failed");
      return { opened: true };
    },
    repairBrief: async (body) => {
      const projectPath = await selectedPath(body);
      await confirmFileChange(projectPath, true);
      return api.repairBrief({ projectPath, confirmed: true });
    },
    providerStatus: async (body) => ({
      ...(await getProvider(body.second ? 1 : 0).status()),
      credentialPersistence: secretSession.sessionOnly()
        ? "session"
        : "os_encrypted",
    }),
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
        if (!(await secrets.health()).available) {
          const result = await dialog.showMessageBox(window, {
            type: "question",
            title: "Sestina",
            message:
              language === "en"
                ? "Secure storage is unavailable. Use the key for this session only?"
                : "安全存储不可用。仅在本次会话使用密钥？",
            detail:
              language === "en"
                ? "The key will stay in memory and be cleared when the project closes or the program exits. You can also cancel and continue local research."
                : "密钥仅保存在内存中，关闭项目或退出程序时清除。也可以取消并继续本地研究。",
            buttons: [
              language === "en" ? "Cancel" : "取消",
              language === "en" ? "Use for this session" : "仅本次会话使用",
            ],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (result.response !== 1) throw Error("confirmation_declined");
          if (api.status().sessionGeneration !== before.sessionGeneration)
            throw Error("session_changed");
          secretSession.enable();
        }
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
      return {
        ...(await service.status()),
        credentialPersistence: secretSession.sessionOnly()
          ? "session"
          : "os_encrypted",
      };
    },
    preferences: async (body) => {
      if (body.action === "read") return preferences.read();
      if (body.action === "save") {
        const patch = record(body.input);
        if (
          Object.keys(patch).some(
            (k) => !["appearance", "recentProjects"].includes(k),
          )
        )
          throw Error("invalid_payload");
        return preferences.update(patch);
      }
      if (body.action === "import") {
        const value = parseDesktopPreferences(body.input);
        await preferences.update(value);
        language = value.language;
        return value;
      }
      throw Error("invalid_payload");
    },
    settingsMigration: async (body) => {
      if (body.action === "status") return migration.inspect();
      if (body.action !== "migrate") throw Error("invalid_payload");
      const result = await migration.run();
      language = result.preferences.language;
      return result;
    },
    integration: async (body) => {
      const session = api.status();
      if (
        !activeProjectPath ||
        body.projectId !== session.projectId ||
        body.sessionGeneration !== session.sessionGeneration
      )
        throw Error("session_changed");
      const directory = app.isPackaged
        ? join(process.resourcesPath, "companion")
        : join(__dirname, "companion");
      const root = await lstat(directory);
      if (!root.isDirectory() || root.isSymbolicLink())
        throw Error("integration_unavailable");
      const command = join(
          directory,
          process.platform === "win32" ? "node.exe" : "node",
        ),
        entry = join(directory, "main.js");
      for (const path of [command, entry]) {
        const file = await lstat(path);
        if (!file.isFile() || file.isSymbolicLink())
          throw Error("integration_unavailable");
      }
      if (body.action === "open_companion") {
        const error = await shell.openPath(join(directory, "skills"));
        if (error) throw Error("integration_unavailable");
        return { opened: true };
      }
      if (body.action !== "config") throw Error("invalid_payload");
      const args = [entry, "--project-root", activeProjectPath];
      return {
        json: JSON.stringify(
          { mcpServers: { sestina: { command, args } } },
          null,
          2,
        ),
        toml: `[mcp_servers.sestina]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`,
        companionDirectory: join(directory, "skills"),
        readOnly: true,
        hostVerification: "unverified",
      };
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
    checkUpdate: () => updater.check(),
    update: async (body) => {
      if (body.action === "status") return updater.status();
      if (body.action === "check") return updater.check();
      if (body.action === "download") return updater.download();
      if (body.action === "cancel") return updater.cancel();
      if (body.action !== "install" && body.action !== "recover_program")
        throw Error("invalid_payload");
      const checked = JSON.stringify(updater.status()),
        expires = Date.now() + 60000;
      if (
        updater.busy ||
        (body.action === "install" && updater.status().stage !== "verified") ||
        (body.action === "recover_program" &&
          !updater.status().rollbackAvailable)
      )
        throw Error("update_not_verified");
      const epoch = navigation,
        generation = api.status().sessionGeneration;
      const en = language === "en",
        version = updater.status().version;
      const choice = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Sestina",
        message:
          body.action === "install"
            ? en
              ? `Install ${version ?? ""}?`
              : `安装 ${version ?? ""}？`
            : en
              ? "Open the verified previous program?"
              : "打开经过验证的旧程序？",
        detail: en
          ? "Saved project data will be protected before installation. The program will close. A previous program must never write a newer project format; use the recovery page to inspect saved backups."
          : "安装前会保护已保存的项目数据，随后关闭程序。旧程序不能写入更新格式的项目；需要恢复时，请在恢复页面检查已有备份。",
        buttons: [
          en ? "Cancel" : "取消",
          body.action === "install"
            ? en
              ? "Install update"
              : "安装更新"
            : en
              ? "Open previous program"
              : "打开旧程序",
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice.response !== 1) throw Error("confirmation_declined");
      if (
        epoch !== navigation ||
        generation !== api.status().sessionGeneration ||
        Date.now() >= expires ||
        checked !== JSON.stringify(updater.status())
      )
        throw Error("session_changed");
      return body.action === "install"
        ? updater.install()
        : updater.recoverProgram();
    },
    closeWindow: () => {
      if (api.maintaining || updater.busy)
        throw new Error("maintenance_in_progress");
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
        maintenance: [
          "projectPath",
          "action",
          "confirmed",
          "previewHash",
          "sessionGeneration",
          "backupId",
          "confirmationNonce",
          "expectedStateBinding",
        ],
        showBackupDirectory: ["projectPath", "sessionGeneration"],
        update: ["action"],
        preferences: ["action", "input"],
        settingsMigration: ["action"],
        pickDirectory: ["initialPath"],
        integration: ["action", "projectId", "sessionGeneration"],
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
    updater.interrupt();
    closeResources();
    if (!window.isDestroyed())
      window.webContents.send("sestina:session-closed");
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
