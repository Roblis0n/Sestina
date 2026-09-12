import { app, safeStorage } from "electron";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { KernelApplicationApi } from "@sestina/application";

// This program is launched by Electron itself, never ELECTRON_RUN_AS_NODE.
const report = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9);
if (!process.versions.electron || process.type !== "browser" || !report)
  throw new Error("Real Electron main runtime and report path required");
void app.whenReady().then(async () => {
const root = await mkdtemp(join(tmpdir(), "sestina-electron-runtime-"));
let api: KernelApplicationApi | undefined;
try {
  const database = new DatabaseSync(join(root, "probe.sqlite"));
  database.exec("CREATE TABLE probe(value TEXT); BEGIN IMMEDIATE; INSERT INTO probe VALUES ('synthetic'); COMMIT;");
  database.close();
  const reopened = new DatabaseSync(join(root, "probe.sqlite"));
  assert.equal(reopened.prepare("SELECT value FROM probe").get()?.value, "synthetic");
  reopened.close();
  api = new KernelApplicationApi({});
  const session = await api.create({ projectPath: root, title: "Synthetic Electron runtime", confirmed: true });
  // Only the actual wire session fields are accepted by the boundary.
  const run = (action: string, body: Record<string, unknown> = {}) => api!.execute({ projectId: session.projectId, sessionGeneration: session.sessionGeneration, action, ...body }, true);
  const review = await run("create", { suggestion: "Retain the synthetic observation limit." }) as { id: string; version: number };
  const skipped = await run("skip_assessment", { reviewId: review.id, expectedVersion: review.version }) as { version: number };
  const prepared = await run("prepare_effect", { reviewId: review.id, expectedVersion: skipped.version, payload: { kind: "record_only", outcome: "reference_only", reason: "Synthetic runtime verification" } }) as { version: number; effectDraft: { previewHash: string; authorityCommandId: string } };
  await run("commit", { reviewId: review.id, expectedVersion: prepared.version, previewHash: prepared.effectDraft.previewHash, authorityCommandId: prepared.effectDraft.authorityCommandId, confirmed: true });
  api.close();
  const next = await api.open({ projectPath: root });
  const read = await api.execute({ projectId: next.projectId, sessionGeneration: next.sessionGeneration, action: "read", reviewId: review.id }, true) as { review: { suggestion: string } };
  assert.equal(read.review.suggestion, "Retain the synthetic observation limit.");
  const available = safeStorage.isEncryptionAvailable();
  if (available && !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
    assert.equal(safeStorage.decryptString(safeStorage.encryptString("synthetic-runtime-secret")), "synthetic-runtime-secret");
  }
  await writeFile(report, JSON.stringify({ passed: true, processType: process.type, versions: process.versions, platform: process.platform, arch: process.arch, sqliteTransactionReopen: true, kernelDraftReopen: true, credentialEncryptionAvailable: available }, null, 2));
} catch {
  await writeFile(report, JSON.stringify({ passed: false, stage: "electron-runtime-probe" }));
  process.exitCode = 1;
} finally {
  api?.dispose();
  await rm(root, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
}
});
