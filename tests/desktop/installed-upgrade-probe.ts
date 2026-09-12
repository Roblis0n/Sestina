import { app } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { strict as assert } from "node:assert";
import { createPreUpgradeProjectStateBackup } from "@sestina/core";
import {
  DesktopUpdater,
  type UpdaterOptions,
} from "../../apps/desktop/src/updater.js";
import {
  preserveInstalledProgram,
  verifyPreservedProgram,
} from "../../apps/desktop/src/runtime-copy.js";
import type { InstalledUpdateIdentity } from "../../apps/desktop/src/update-policy.js";

// This isolated acceptance assembly never changes the installed trust roots.
// It uses the real Electron runtime, SQLite backup, program copy and NSIS installer.
const workspace = resolve(
  process.argv.find((a) => a.startsWith("--workspace="))?.slice(12) ?? "",
);
const area = join(workspace, ".tmp/g10-g11"),
  installed = join(area, "installed"),
  projectRoot = join(area, "install-project");
const reportPath = join(area, "installed-upgrade-result.json");
void app.whenReady().then(async () => {
  try {
    assert.equal(process.platform, "win32");
    assert.equal(process.type, "browser");
    const current: InstalledUpdateIdentity = JSON.parse(
      await readFile(join(area, "upgrade-current-identity.json"), "utf8"),
    );
    current.sequence ??= 0;
    const next = JSON.parse(
      await readFile(
        join(workspace, "release/desktop/win32-x64/candidate-manifest.json"),
        "utf8",
      ),
    );
    const installer = join(
      workspace,
      "release/desktop/win32-x64",
      `Sestina Candidate Setup ${next.version}.exe`,
    );
    const bytes = await readFile(installer),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const offer = {
      format: "2.0.0",
      version: next.version,
      channel: next.channel,
      sequence: next.sequence,
      platform: next.platform,
      arch: next.arch,
      schema: next.schema,
      sourceCommit: next.sourceCommit,
      migrationSourceSha256: next.migrationSourceSha256,
      sha256,
      size: bytes.length,
      unsignedCoreSha256: next.unsignedCoreSha256,
      artifactPath: `/artifacts/${sha256}/Sestina.exe`,
      signed: false,
    };
    const keys = generateKeyPairSync("ed25519"),
      payload = JSON.stringify(offer);
    const envelope = {
      payload,
      keyId: "isolated-acceptance",
      signature: sign(null, Buffer.from(payload), keys.privateKey).toString(
        "base64",
      ),
    };
    const directory = join(area, `update-acceptance-${next.sourceCommit}`),
      rollbackRoot = join(directory, "rollback");
    await mkdir(directory, { recursive: true });
    let requests = 0,
      launches = 0,
      restoredProgram = "";
    const options: UpdaterOptions = {
      directory,
      current,
      roots: {
        "isolated-acceptance": keys.publicKey
          .export({ format: "pem", type: "spki" })
          .toString(),
      },
      source: "https://synthetic.invalid/candidate.json",
      fetch: async (url) => {
        requests++;
        return new Response(
          url.endsWith("candidate.json") ? JSON.stringify(envelope) : bytes,
        );
      },
      beforeInstall: async () => {
        const backup = await createPreUpgradeProjectStateBackup({
          projectRoot,
          kernelRecovery: true,
        });
        assert.ok(backup.ok);
        return { backupId: backup.value.backupId, projectPath: projectRoot };
      },
      preserveProgram: async () => {
        try {
          return await preserveInstalledProgram(
            installed,
            rollbackRoot,
            current.sourceCommit,
          );
        } catch (error) {
          await writeFile(
            join(area, "program-copy-failure.txt"),
            String(error instanceof Error ? error.stack : error),
          );
          throw error;
        }
      },
      launchInstaller: async (path) => {
        launches++;
        await new Promise<void>((done, reject) => {
          const child = spawn(path, ["/S", `/D=${installed}`], {
            windowsHide: true,
            windowsVerbatimArguments: true,
            stdio: "ignore",
          });
          child.once("error", reject);
          child.once("exit", (code) =>
            code === 0 ? done() : reject(Error("update_installer_failed")),
          );
        });
      },
      restoreProgram: async (id) => {
        restoredProgram = await verifyPreservedProgram(rollbackRoot, id);
      },
    };
    const blocked = new DesktopUpdater({
      ...options,
      directory: join(directory, "backup-failure"),
      beforeInstall: async () => {
        throw Error("Synthetic backup unavailable");
      },
    });
    assert.equal((await blocked.check()).stage, "available");
    assert.equal((await blocked.download()).stage, "verified");
    assert.equal((await blocked.install()).stage, "failed");
    assert.equal(launches, 0);
    const update = new DesktopUpdater(options);
    await update.initialize();
    const beforeCheck = requests;
    assert.equal((await update.check()).stage, "available");
    assert.equal((await update.download()).stage, "verified");
    assert.equal((await update.install()).stage, "installing");
    assert.equal(launches, 1);
    const actual: InstalledUpdateIdentity = JSON.parse(
      await readFile(
        join(installed, "resources/app.asar/dist/identity.json"),
        "utf8",
      ),
    );
    assert.equal(actual.sourceCommit, next.sourceCommit);
    const restarted = new DesktopUpdater({ ...options, current: actual });
    assert.equal((await restarted.initialize()).stage, "installed");
    assert.equal(requests, beforeCheck + 2);
    await restarted.recoverProgram();
    assert.ok(restoredProgram);
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          passed: true,
          electron: process.versions.electron,
          current,
          next: actual,
          installerSha256: sha256,
          backupFailureBlockedInstaller: true,
          realSilentInstallerExit: 0,
          restartReconciledWithoutRequest: true,
          update: restarted.status(),
          restoredProgram,
          projectRoot,
          syntheticSource: "constructor_only_no_network",
          nativeInstallerUI: "not_exercised_by_this_probe",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile(
      reportPath,
      JSON.stringify({
        passed: false,
        error: error instanceof Error ? error.message : "probe_failed",
      }),
    );
    process.exitCode = 1;
  } finally {
    app.exit(process.exitCode ?? 0);
  }
});
