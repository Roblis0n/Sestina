import { _electron } from "@playwright/test";
import { strict as assert } from "node:assert";
import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const area = resolve(process.env.SESTINA_UPGRADE_AREA ?? "");
const installer = process.env.SESTINA_UPGRADE_INSTALLER;
const manifest = JSON.parse(
  await readFile(process.env.SESTINA_UPGRADE_MANIFEST!, "utf8"),
);
if (
  !installer ||
  process.platform !== "win32" ||
  !relative(resolve(".tmp"), area) ||
  relative(resolve(".tmp"), area).startsWith("..")
)
  throw Error("isolated_reinstall_inputs_required");
const installed = join(area, "installed"),
  profile = join(area, "continuity-profile"),
  project = join(area, "install-project");
const executable = join(installed, `${manifest.executableName}.exe`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const sha = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
async function useApp(initialize: boolean) {
  const oldDirectory =
    initialize && process.env.SESTINA_PREVIOUS_INSTALLED
      ? resolve(process.env.SESTINA_PREVIOUS_INSTALLED)
      : undefined;
  if (oldDirectory && relative(resolve(".tmp"), oldDirectory).startsWith(".."))
    throw Error("old_profile_seed_must_be_isolated");
  const app = await _electron.launch({
    executablePath: oldDirectory
      ? join(oldDirectory, "Sestina Candidate.exe")
      : executable,
    args: [`--user-data-dir=${profile}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.sestinaDesktop));
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    const invoke = async (method: string, body: object = {}) => {
      const reply = await page.evaluate(
        ({ method, body }) =>
          (window.sestinaDesktop!.methods as any)[method](body),
        { method, body },
      );
      assert.equal(reply.ok, true, JSON.stringify(reply.error));
      return reply.value;
    };
    if (initialize) await invoke("language", { language: "en" });
    const preferences = await invoke("preferences", { action: "read" });
    assert.equal(preferences.language, "en");
    const secret = await app.evaluate(
      async ({ app, safeStorage }, initialize) => {
        const fs = (process as any).mainModule.require("node:fs/promises");
        const directory = `${app.getPath("userData")}/credentials`;
        const file = `${directory}/synthetic-continuity.enc`;
        if (initialize) {
          await fs.mkdir(directory, { recursive: true });
          await fs.writeFile(
            file,
            safeStorage.encryptString(
              "synthetic-local-continuity-not-a-real-key",
            ),
          );
        }
        return {
          storageName: app.getName(),
          decrypted: safeStorage.decryptString(await fs.readFile(file)),
        };
      },
      initialize,
    );
    assert.equal(secret.storageName, "Sestina Candidate");
    assert.equal(secret.decrypted, "synthetic-local-continuity-not-a-real-key");
    await app.evaluate(({ dialog }, project) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [project],
      });
    }, project);
    await invoke("pickDirectory");
    const session = await invoke("open", { projectPath: project });
    const brief = await page.evaluate(
      async (session) =>
        window.sestinaDesktop!.commands.brief({
          action: "brief",
          projectId: session.projectId,
          sessionGeneration: session.sessionGeneration,
        }),
      session,
    );
    assert.equal(brief.ok, true);
    assert.ok((brief.value as any).brief);
    const about = await invoke("about");
    if (!oldDirectory) assert.equal(about.version, manifest.version);
    await invoke("closeProject");
    return { brief: brief.value, preferences, about, credentialReadable: true };
  } finally {
    await app
      .evaluate(({ app }) => {
        setTimeout(() => app.exit(0), 0);
      })
      .catch(() => undefined);
    await app.close().catch(() => undefined);
  }
}
const before = await useApp(true);
const renamed = await useApp(false);
assert.deepEqual(renamed.brief, before.brief);
assert.deepEqual(renamed.preferences, before.preferences);
const preserved = async () => ({
  preferences: sha(await readFile(join(profile, "preferences.json"))),
  credential: sha(
    await readFile(join(profile, "credentials/synthetic-continuity.enc")),
  ),
});
const beforeFiles = await preserved();
const uninstaller = (await readdir(installed)).filter(
  (name) => name === `Uninstall ${manifest.productName}.exe`,
);
assert.equal(uninstaller.length, 1);
const run = async (file: string, args: string[]) =>
  new Promise<void>((done, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) done();
      else reject(Error(`lifecycle_exit_${code}`));
    });
  });
// Supported silent NSIS contract. This is not native-wizard/focus evidence.
await run(join(installed, uninstaller[0]!), ["/S", `_?=${installed}`]);
assert.equal(
  await access(executable).then(
    () => true,
    () => false,
  ),
  false,
);
assert.deepEqual(await preserved(), beforeFiles);
await run(resolve(installer), ["/S", `/D=${installed}`]);
const after = await useApp(false);
assert.deepEqual(after.brief, before.brief);
assert.deepEqual(after.preferences, before.preferences);
assert.deepEqual(await preserved(), beforeFiles);
await writeFile(
  join(area, "reinstall-result.json"),
  JSON.stringify(
    {
      passed: true,
      sourceCommit: manifest.sourceCommit,
      installerSha256: sha(await readFile(installer)),
      platform: process.platform,
      arch: process.arch,
      cases: [
        "current-package-actual-silent-uninstall",
        "project-brief-preserved-and-reopened",
        "settings-and-encrypted-credential-preserved",
        "actual-reinstall-same-package",
      ],
      nativeWizard: "not_established",
      nativeCredentialEntry: "not_established",
      beforeFiles,
      before,
      after,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ passed: true, result: join(area, "reinstall-result.json") }),
);
