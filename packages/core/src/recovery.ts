import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  backupDatabase,
  assertInsideRoot,
  checkDatabaseIntegrity,
  hashFile,
  MaintenanceGuard,
  openDatabase,
  readSchemaVersion,
  RUNTIME_VERSION,
  SCHEMA_VERSION,
} from "@sestina/storage";
import { coreErr, coreOk, type CoreErrorCode, type CoreResult } from "./errors.js";
import { openSestina } from "./sestina-core.js";

const MANIFEST_SCHEMA_VERSION = "1.0.0" as const;
const DATABASE_FILE = "state.sqlite";
const DATABASE_HASH_FILE = "state.sqlite.sha256";
const BRIEF_FILE = "research-brief.yaml";
const BRIEF_HASH_FILE = "research-brief.yaml.sha256";
const MANIFEST_FILE = "manifest.json";
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_BRIEF_BYTES = 4 * 1024 * 1024;
const MAX_DATABASE_BYTES = 16 * 1024 * 1024 * 1024;
const MANAGED_ID = /^(?:bkp|pre)_\d{8}T\d{9}Z_[0-9a-f]{12}$/;
const MANUAL_ID = /^bkp_\d{8}T\d{9}Z_[0-9a-f]{12}$/;
const FORENSIC_ID = /^forensic_\d{8}T\d{9}Z_[0-9a-f]{12}$/;
const MANIFEST_KEYS = [
  "activeBriefId", "activeBriefVersionId", "backupId", "bindingHash", "brief", "createdAt",
  "database", "databaseSchemaVersion", "kind", "projectId", "runtimeVersion", "schemaVersion",
] as const;

export interface RecoveryFaultInjection {
  readonly beforePublish?: () => void | Promise<void>;
  readonly afterSourceValidation?: () => void | Promise<void>;
  readonly beforeBriefCommit?: () => void | Promise<void>;
  readonly beforeRollback?: () => void | Promise<void>;
}

export interface ProjectRecoveryOptions {
  readonly projectRoot: string;
  readonly maintenanceBusyTimeoutMs?: number;
  readonly faultInjection?: RecoveryFaultInjection;
}

export interface RestoreProjectStateOptions extends ProjectRecoveryOptions {
  readonly backupId: string;
  readonly confirmed: boolean;
}

export interface PreviewProjectStateRestoreOptions {
  readonly projectRoot: string;
  readonly backupId: string;
}

export interface RecoveryBackupSummary {
  readonly backupId: string;
  readonly kind: "manual" | "pre_restore";
  readonly createdAt?: string;
  readonly projectId?: string;
  readonly databaseSchemaVersion?: number;
  readonly databaseSizeBytes?: number;
  readonly briefSizeBytes?: number;
  readonly verification: "verified" | "failed";
  readonly valid: boolean;
}

export interface ProjectRecoveryStatus {
  readonly currentState: "healthy" | "recovery_required";
  readonly databaseIntegrity: "ok" | "failed" | "missing";
  readonly currentBriefBinding: "matched" | "mismatched" | "unavailable";
  readonly schema: { readonly status: "recognized" | "too_new" | "unavailable"; readonly version?: number; readonly supportedVersion: number };
  readonly projectId?: string;
  readonly restoreAvailable: boolean;
  readonly backups: readonly RecoveryBackupSummary[];
  readonly networkUsed: false;
}

export interface ProjectStateBackupResult {
  readonly backupId: string;
  readonly kind: "manual" | "pre_restore";
  readonly projectId: string;
  readonly integrity: "ok";
  readonly briefBinding: "matched";
  readonly databaseHash: string;
  readonly briefHash: string;
  readonly bindingHash: string;
  readonly databaseSchemaVersion: number;
  readonly databaseSizeBytes: number;
  readonly briefSizeBytes: number;
  readonly networkUsed: false;
}

export interface ProjectStateRestorePreview {
  readonly backupId: string;
  readonly kind: "manual" | "pre_restore";
  readonly projectId: string;
  readonly createdAt: string;
  readonly databaseIntegrity: "ok";
  readonly briefBinding: "matched";
  readonly databaseSchemaVersion: number;
  readonly databaseSizeBytes: number;
  readonly briefSizeBytes: number;
  readonly currentStatePreservation: "complete_bundle_or_forensic_copy";
  readonly confirmationRequired: true;
  readonly networkUsed: false;
}

export interface ProjectStateRestoreResult {
  readonly restored: true;
  readonly backupId: string;
  readonly projectId: string;
  readonly preRestoreBackupId: string;
  readonly forensicCopyPreserved: boolean;
  readonly databaseIntegrity: "ok";
  readonly briefBinding: "matched";
  readonly networkUsed: false;
}

interface BundleManifest {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly backupId: string;
  readonly kind: "manual" | "pre_restore";
  readonly createdAt: string;
  readonly runtimeVersion: string;
  readonly databaseSchemaVersion: number;
  readonly projectId: string;
  readonly activeBriefId: string;
  readonly activeBriefVersionId: string;
  readonly database: { readonly sha256: string; readonly sizeBytes: number };
  readonly brief: { readonly sha256: string; readonly sizeBytes: number };
  readonly bindingHash: string;
}

interface ValidBundle {
  readonly directory: string;
  readonly manifest: BundleManifest;
  readonly databasePath: string;
  readonly briefPath: string;
  readonly manifestBytes: string;
}

interface ProjectPaths {
  readonly projectRoot: string;
  readonly dataRoot: string;
  readonly databasePath: string;
  readonly briefPath: string;
  readonly manualRoot: string;
  readonly forensicRoot: string;
}

class RecoveryFailure extends Error {
  readonly code: CoreErrorCode;
  constructor(code: CoreErrorCode) { super(code); this.code = code; }
}

function fail(code: CoreErrorCode): never { throw new RecoveryFailure(code); }

function resultFor<T>(error: unknown): CoreResult<T> {
  return coreErr(error instanceof RecoveryFailure ? error.code : "infrastructure_failure");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHash(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function isUtc(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.endsWith("Z"); }
function isSafeSize(value: unknown, maximum: number): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum; }

function bindingHash(input: Pick<BundleManifest, "projectId" | "activeBriefId" | "activeBriefVersionId" | "database" | "brief">): string {
  return sha256(JSON.stringify({
    projectId: input.projectId,
    activeBriefId: input.activeBriefId,
    activeBriefVersionId: input.activeBriefVersionId,
    databaseSha256: input.database.sha256,
    briefSha256: input.brief.sha256,
  }));
}

function parseManifest(value: unknown, expectedId: string): BundleManifest {
  if (!isRecord(value) || !sameKeys(value, MANIFEST_KEYS)) fail("state_conflict");
  const database = value.database; const brief = value.brief;
  if (!isRecord(database) || !sameKeys(database, ["sha256", "sizeBytes"])) fail("state_conflict");
  if (!isRecord(brief) || !sameKeys(brief, ["sha256", "sizeBytes"])) fail("state_conflict");
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION || value.backupId !== expectedId || !MANAGED_ID.test(expectedId)) fail("state_conflict");
  if (value.kind !== "manual" && value.kind !== "pre_restore") fail("state_conflict");
  if ((value.kind === "manual") !== MANUAL_ID.test(expectedId)) fail("state_conflict");
  if (!isUtc(value.createdAt) || typeof value.runtimeVersion !== "string" || value.runtimeVersion.length > 128) fail("state_conflict");
  if (!Number.isSafeInteger(value.databaseSchemaVersion) || Number(value.databaseSchemaVersion) < 1 || Number(value.databaseSchemaVersion) > SCHEMA_VERSION) fail("state_conflict");
  for (const name of ["projectId", "activeBriefId", "activeBriefVersionId"] as const) {
    const field = value[name]; if (typeof field !== "string" || field.length < 3 || field.length > 256) fail("state_conflict");
  }
  if (!isHash(database.sha256) || !isSafeSize(database.sizeBytes, MAX_DATABASE_BYTES)) fail("state_conflict");
  if (!isHash(brief.sha256) || !isSafeSize(brief.sizeBytes, MAX_BRIEF_BYTES)) fail("state_conflict");
  if (!isHash(value.bindingHash)) fail("state_conflict");
  const manifest = value as unknown as BundleManifest;
  if (bindingHash(manifest) !== manifest.bindingHash) fail("state_conflict");
  return manifest;
}

function timestampId(prefix: "bkp" | "pre" | "forensic"): string {
  const stamp = new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
  return `${prefix}_${stamp}_${randomBytes(6).toString("hex")}`;
}

async function regularFile(path: string, maximum: number): Promise<{ size: number }> {
  const value = await lstat(path).catch(() => undefined);
  if (value === undefined || !value.isFile() || value.isSymbolicLink() || value.size > maximum) fail("state_conflict");
  return { size: value.size };
}

async function pathsFor(rawProjectRoot: string): Promise<ProjectPaths> {
  if (typeof rawProjectRoot !== "string" || rawProjectRoot.trim().length === 0) fail("invalid_input");
  const projectRoot = await realpath(resolve(rawProjectRoot)).catch(() => fail("not_found"));
  const dataRoot = join(projectRoot, ".sestina");
  const dataStat = await lstat(dataRoot).catch(() => undefined);
  if (dataStat === undefined || !dataStat.isDirectory() || dataStat.isSymbolicLink()) fail("not_found");
  const dataReal = await realpath(dataRoot).catch(() => fail("infrastructure_failure"));
  const rel = relative(projectRoot, dataReal);
  if (rel === ".." || rel.startsWith(`..${sep}`)) fail("invalid_input");
  const paths = {
    projectRoot, dataRoot: dataReal,
    databasePath: join(dataReal, DATABASE_FILE), briefPath: join(dataReal, BRIEF_FILE),
    manualRoot: join(dataReal, "backups", "manual"), forensicRoot: join(dataReal, "backups", "forensic"),
  };
  for (const candidate of [join(dataReal, "backups"), paths.manualRoot, paths.forensicRoot]) {
    const info = await lstat(candidate).catch(() => undefined);
    if (info === undefined) continue;
    if (!info.isDirectory() || info.isSymbolicLink()) fail("invalid_input");
    const candidateReal = await realpath(candidate).catch(() => fail("infrastructure_failure"));
    const candidateRel = relative(dataReal, candidateReal);
    if (candidateRel === ".." || candidateRel.startsWith(`..${sep}`)) fail("invalid_input");
  }
  return paths;
}

async function assertManagedDirectory(manualRoot: string, backupId: string): Promise<string> {
  if (!MANAGED_ID.test(backupId)) fail("invalid_input");
  const directory = join(manualRoot, backupId);
  const located = await lstat(directory).catch(() => undefined);
  if (located === undefined) fail("not_found");
  if (!located.isDirectory() || located.isSymbolicLink()) fail("invalid_input");
  const manualReal = await realpath(manualRoot).catch(() => fail("infrastructure_failure"));
  const directoryReal = await realpath(directory).catch(() => fail("infrastructure_failure"));
  const rel = relative(manualReal, directoryReal);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(sep)) fail("invalid_input");
  return directoryReal;
}

async function validateDatabaseBriefBinding(databasePath: string, briefText: string, manifest: BundleManifest): Promise<void> {
  const database = await openDatabase({ path: databasePath, readOnly: true, immutable: true }).catch(() => fail("state_conflict"));
  try {
    const integrityRows = database.raw.prepare("PRAGMA integrity_check").all() as Record<string, unknown>[];
    if (integrityRows.length === 0 || !integrityRows.every((row) => Object.values(row).every((value) => value === "ok"))) fail("state_conflict");
    if (readSchemaVersion(database) !== manifest.databaseSchemaVersion) fail("state_conflict");
  } finally { database.close(); }
  const opened = await openSestina({ databasePath, readOnly: true, immutable: true });
  if (!opened.ok) fail("state_conflict");
  try {
    const projects = opened.value.listProjects();
    if (!projects.ok || projects.value.length !== 1 || projects.value[0]?.id !== manifest.projectId) fail("state_conflict");
    const projection = opened.value.getActiveBriefProjection(manifest.projectId);
    if (!projection.ok || projection.value === undefined) fail("state_conflict");
    if (projection.value.briefId !== manifest.activeBriefId || projection.value.versionId !== manifest.activeBriefVersionId || projection.value.yaml !== briefText) fail("state_conflict");
  } finally { opened.value.close(); }
}

async function validateBundle(paths: ProjectPaths, backupId: string): Promise<ValidBundle> {
  const directory = await assertManagedDirectory(paths.manualRoot, backupId);
  const entries = (await readdir(directory)).sort();
  const expected = [BRIEF_FILE, BRIEF_HASH_FILE, DATABASE_FILE, DATABASE_HASH_FILE, MANIFEST_FILE].sort();
  if (entries.length !== expected.length || !entries.every((entry, index) => entry === expected[index])) fail("state_conflict");
  const manifestPath = join(directory, MANIFEST_FILE); const databasePath = join(directory, DATABASE_FILE); const briefPath = join(directory, BRIEF_FILE);
  const manifestStat = await regularFile(manifestPath, MAX_MANIFEST_BYTES);
  await regularFile(join(directory, DATABASE_HASH_FILE), 128); await regularFile(join(directory, BRIEF_HASH_FILE), 128);
  const databaseStat = await regularFile(databasePath, MAX_DATABASE_BYTES); const briefStat = await regularFile(briefPath, MAX_BRIEF_BYTES);
  const manifestBytes = await readFile(manifestPath, "utf8");
  if (Buffer.byteLength(manifestBytes) !== manifestStat.size) fail("state_conflict");
  let parsed: unknown; try { parsed = JSON.parse(manifestBytes); } catch { fail("state_conflict"); }
  const manifest = parseManifest(parsed, backupId);
  const databaseHash = await hashFile(databasePath).catch(() => fail("state_conflict"));
  const briefBuffer = await readFile(briefPath); const briefHash = sha256(briefBuffer);
  const databaseSidecar = await readFile(join(directory, DATABASE_HASH_FILE), "utf8");
  const briefSidecar = await readFile(join(directory, BRIEF_HASH_FILE), "utf8");
  if (databaseHash !== manifest.database.sha256 || databaseStat.size !== manifest.database.sizeBytes || databaseSidecar !== `${databaseHash}\n`) fail("state_conflict");
  if (briefHash !== manifest.brief.sha256 || briefStat.size !== manifest.brief.sizeBytes || briefSidecar !== `${briefHash}\n`) fail("state_conflict");
  await validateDatabaseBriefBinding(databasePath, briefBuffer.toString("utf8"), manifest);
  return { directory, manifest, databasePath, briefPath, manifestBytes };
}

async function buildBundle(paths: ProjectPaths, kind: "manual" | "pre_restore", faultInjection?: RecoveryFaultInjection): Promise<ValidBundle> {
  const backupId = timestampId(kind === "manual" ? "bkp" : "pre");
  await mkdir(paths.manualRoot, { recursive: true });
  try { assertInsideRoot(paths.dataRoot, paths.manualRoot, "manual recovery directory"); } catch { fail("invalid_input"); }
  const manualStat = await lstat(paths.manualRoot); if (!manualStat.isDirectory() || manualStat.isSymbolicLink()) fail("invalid_input");
  const temporaryDirectory = join(paths.manualRoot, `.tmp-${backupId}-${randomBytes(4).toString("hex")}`);
  const destination = join(paths.manualRoot, backupId);
  let published = false;
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    const sourceBriefStat = await regularFile(paths.briefPath, MAX_BRIEF_BYTES);
    const briefBuffer = await readFile(paths.briefPath);
    if (briefBuffer.byteLength !== sourceBriefStat.size) fail("state_conflict");
    const source = await openDatabase({ path: paths.databasePath, readOnly: true }).catch(() => fail("state_conflict"));
    let backup;
    try { backup = await backupDatabase(source, { backupDirectory: temporaryDirectory, dataRoot: paths.dataRoot }); }
    catch { fail("state_conflict"); }
    finally { source.close(); }
    await rm(`${backup.path}-wal`, { force: true }); await rm(`${backup.path}-shm`, { force: true });
    const databasePath = join(temporaryDirectory, DATABASE_FILE);
    await rename(backup.path, databasePath);
    await rm(`${backup.path}.sha256`, { force: true });
    const briefPath = join(temporaryDirectory, BRIEF_FILE);
    await writeFile(briefPath, briefBuffer, { flag: "wx" });
    const briefDigest = sha256(briefBuffer);
    await writeFile(join(temporaryDirectory, DATABASE_HASH_FILE), `${backup.hash}\n`, { encoding: "utf8", flag: "wx" });
    await writeFile(join(temporaryDirectory, BRIEF_HASH_FILE), `${briefDigest}\n`, { encoding: "utf8", flag: "wx" });

    const opened = await openSestina({ databasePath, readOnly: true, immutable: true });
    if (!opened.ok) fail("state_conflict");
    let projectId: string; let activeBriefId: string; let activeBriefVersionId: string;
    try {
      const projects = opened.value.listProjects();
      if (!projects.ok || projects.value.length !== 1 || projects.value[0] === undefined) fail("state_conflict");
      projectId = projects.value[0].id;
      const projection = opened.value.getActiveBriefProjection(projectId);
      if (!projection.ok || projection.value?.yaml !== briefBuffer.toString("utf8")) fail("state_conflict");
      activeBriefId = projection.value.briefId; activeBriefVersionId = projection.value.versionId;
    } finally { opened.value.close(); }
    const manifestBase = {
      schemaVersion: MANIFEST_SCHEMA_VERSION, backupId, kind, createdAt: new Date().toISOString(), runtimeVersion: RUNTIME_VERSION,
      databaseSchemaVersion: backup.version, projectId, activeBriefId, activeBriefVersionId,
      database: { sha256: backup.hash, sizeBytes: backup.sizeBytes }, brief: { sha256: briefDigest, sizeBytes: briefBuffer.byteLength },
    };
    const manifest: BundleManifest = { ...manifestBase, bindingHash: bindingHash(manifestBase) };
    await writeFile(join(temporaryDirectory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await validateDatabaseBriefBinding(databasePath, briefBuffer.toString("utf8"), manifest);
    await faultInjection?.beforePublish?.();
    await rename(temporaryDirectory, destination);
    published = true;
    return await validateBundle(paths, backupId);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (published) await rm(destination, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function snapshotCurrentToTemporary(paths: ProjectPaths): Promise<{ directory: string; databasePath?: string; briefText?: string }> {
  const directory = await mkdtemp(join(tmpdir(), "sestina-recovery-status-"));
  const databaseStat = await lstat(paths.databasePath).catch(() => undefined);
  if (databaseStat?.isFile() && !databaseStat.isSymbolicLink()) {
    const databasePath = join(directory, DATABASE_FILE);
    await copyFile(paths.databasePath, databasePath);
    for (const suffix of ["-wal", "-shm"]) {
      const source = `${paths.databasePath}${suffix}`;
      const sidecar = await lstat(source).catch(() => undefined);
      if (sidecar?.isFile() && !sidecar.isSymbolicLink()) await copyFile(source, `${databasePath}${suffix}`);
    }
  }
  const briefStat = await lstat(paths.briefPath).catch(() => undefined);
  const briefText = briefStat?.isFile() && !briefStat.isSymbolicLink() && briefStat.size <= MAX_BRIEF_BYTES
    ? await readFile(paths.briefPath, "utf8") : undefined;
  return { directory, ...(databaseStat?.isFile() ? { databasePath: join(directory, DATABASE_FILE) } : {}), ...(briefText === undefined ? {} : { briefText }) };
}

async function inspectCurrent(paths: ProjectPaths): Promise<Pick<ProjectRecoveryStatus, "currentState" | "databaseIntegrity" | "currentBriefBinding" | "projectId" | "schema">> {
  const snapshot = await snapshotCurrentToTemporary(paths);
  try {
    if (snapshot.databasePath === undefined) return { currentState: "recovery_required", databaseIntegrity: "missing", currentBriefBinding: "unavailable", schema: { status: "unavailable", supportedVersion: SCHEMA_VERSION } };
    if (!checkDatabaseIntegrity(snapshot.databasePath, "full").ok) return { currentState: "recovery_required", databaseIntegrity: "failed", currentBriefBinding: "unavailable", schema: { status: "unavailable", supportedVersion: SCHEMA_VERSION } };
    const schemaDatabase = await openDatabase({ path: snapshot.databasePath, readOnly: true }).catch(() => undefined);
    const schemaVersion = schemaDatabase === undefined ? undefined : readSchemaVersion(schemaDatabase);
    schemaDatabase?.close();
    const schema = schemaVersion === undefined || schemaVersion < 1
      ? { status: "unavailable" as const, supportedVersion: SCHEMA_VERSION }
      : { status: schemaVersion > SCHEMA_VERSION ? "too_new" as const : "recognized" as const, version: schemaVersion, supportedVersion: SCHEMA_VERSION };
    const opened = await openSestina({ databasePath: snapshot.databasePath, readOnly: true });
    if (!opened.ok) return { currentState: "recovery_required", databaseIntegrity: "failed", currentBriefBinding: "unavailable", schema };
    try {
      const projects = opened.value.listProjects();
      if (!projects.ok || projects.value.length !== 1 || projects.value[0] === undefined) return { currentState: "recovery_required", databaseIntegrity: "ok", currentBriefBinding: "unavailable", schema };
      const projectId = projects.value[0].id; const projection = opened.value.getActiveBriefProjection(projectId);
      const matched = projection.ok && projection.value !== undefined && snapshot.briefText === projection.value.yaml;
      return { currentState: matched && schema.status === "recognized" ? "healthy" : "recovery_required", databaseIntegrity: "ok", currentBriefBinding: matched ? "matched" : "mismatched", projectId, schema };
    } finally { opened.value.close(); }
  } finally { await rm(snapshot.directory, { recursive: true, force: true }); }
}

async function validBackupSummaries(paths: ProjectPaths): Promise<readonly RecoveryBackupSummary[]> {
  const root = await lstat(paths.manualRoot).catch(() => undefined);
  if (root === undefined) return [];
  if (!root.isDirectory() || root.isSymbolicLink()) return [];
  const names = await readdir(paths.manualRoot);
  const summaries: RecoveryBackupSummary[] = [];
  for (const name of names.filter((item) => MANAGED_ID.test(item)).sort()) {
    try {
      const bundle = await validateBundle(paths, name);
      summaries.push({
        backupId: name, kind: bundle.manifest.kind, createdAt: bundle.manifest.createdAt, projectId: bundle.manifest.projectId,
        databaseSchemaVersion: bundle.manifest.databaseSchemaVersion, databaseSizeBytes: bundle.manifest.database.sizeBytes,
        briefSizeBytes: bundle.manifest.brief.sizeBytes, verification: "verified", valid: true,
      });
    } catch {
      summaries.push({ backupId: name, kind: MANUAL_ID.test(name) ? "manual" : "pre_restore", verification: "failed", valid: false });
    }
  }
  return summaries.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || right.backupId.localeCompare(left.backupId));
}

export async function inspectProjectRecovery(options: ProjectRecoveryOptions): Promise<CoreResult<ProjectRecoveryStatus>> {
  try {
    const paths = await pathsFor(options.projectRoot);
    const current = await inspectCurrent(paths); const backups = await validBackupSummaries(paths);
    return coreOk(Object.freeze({ ...current, restoreAvailable: backups.some((backup) => backup.valid), backups: Object.freeze(backups), networkUsed: false as const }));
  } catch (error) { return resultFor(error); }
}

export async function createProjectStateBackup(options: ProjectRecoveryOptions): Promise<CoreResult<ProjectStateBackupResult>> {
  let guard: MaintenanceGuard | undefined;
  try {
    const paths = await pathsFor(options.projectRoot);
    guard = await MaintenanceGuard.acquire({ databasePath: paths.databasePath, ownerId: `core-backup-${process.pid}`, scope: "manual_backup", busyTimeoutMs: options.maintenanceBusyTimeoutMs });
    const bundle = await buildBundle(paths, "manual", options.faultInjection);
    return coreOk(Object.freeze({
      backupId: bundle.manifest.backupId, kind: bundle.manifest.kind, projectId: bundle.manifest.projectId,
      integrity: "ok" as const, briefBinding: "matched" as const, databaseHash: bundle.manifest.database.sha256,
      briefHash: bundle.manifest.brief.sha256, bindingHash: bundle.manifest.bindingHash,
      databaseSchemaVersion: bundle.manifest.databaseSchemaVersion, databaseSizeBytes: bundle.manifest.database.sizeBytes,
      briefSizeBytes: bundle.manifest.brief.sizeBytes, networkUsed: false as const,
    }));
  } catch (error) { return resultFor(error); }
  finally { guard?.release(); }
}

export async function previewProjectStateRestore(options: PreviewProjectStateRestoreOptions): Promise<CoreResult<ProjectStateRestorePreview>> {
  try {
    const paths = await pathsFor(options.projectRoot); const bundle = await validateBundle(paths, options.backupId);
    return coreOk(Object.freeze({
      backupId: bundle.manifest.backupId, kind: bundle.manifest.kind, projectId: bundle.manifest.projectId,
      createdAt: bundle.manifest.createdAt, databaseIntegrity: "ok" as const, briefBinding: "matched" as const,
      databaseSchemaVersion: bundle.manifest.databaseSchemaVersion, databaseSizeBytes: bundle.manifest.database.sizeBytes,
      briefSizeBytes: bundle.manifest.brief.sizeBytes, currentStatePreservation: "complete_bundle_or_forensic_copy" as const,
      confirmationRequired: true as const, networkUsed: false as const,
    }));
  } catch (error) { return resultFor(error); }
}

async function preserveForensic(paths: ProjectPaths): Promise<string> {
  const forensicId = timestampId("forensic"); if (!FORENSIC_ID.test(forensicId)) fail("infrastructure_failure");
  await mkdir(paths.forensicRoot, { recursive: true });
  try { assertInsideRoot(paths.dataRoot, paths.forensicRoot, "forensic recovery directory"); } catch { fail("invalid_input"); }
  const temporary = join(paths.forensicRoot, `.tmp-${forensicId}`); const destination = join(paths.forensicRoot, forensicId);
  await mkdir(temporary, { recursive: false });
  try {
    const files: { name: string; sha256: string; sizeBytes: number }[] = [];
    for (const [source, name, maximum] of [
      [paths.databasePath, DATABASE_FILE, MAX_DATABASE_BYTES], [`${paths.databasePath}-wal`, `${DATABASE_FILE}-wal`, MAX_DATABASE_BYTES],
      [`${paths.databasePath}-shm`, `${DATABASE_FILE}-shm`, MAX_DATABASE_BYTES], [paths.briefPath, BRIEF_FILE, MAX_BRIEF_BYTES],
    ] as const) {
      const info = await lstat(source).catch(() => undefined);
      if (info === undefined) continue;
      if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) fail("infrastructure_failure");
      const target = join(temporary, name); await copyFile(source, target);
      files.push({ name, sha256: await hashFile(target), sizeBytes: info.size });
    }
    if (files.length === 0) fail("infrastructure_failure");
    await writeFile(join(temporary, MANIFEST_FILE), `${JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, forensicId, kind: "forensic_pre_restore", createdAt: new Date().toISOString(), files }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
    return forensicId;
  } catch (error) { await rm(temporary, { recursive: true, force: true }).catch(() => undefined); throw error; }
}

async function validateStagedPair(databasePath: string, briefPath: string, manifest: BundleManifest): Promise<void> {
  const databaseInfo = await regularFile(databasePath, MAX_DATABASE_BYTES); const briefInfo = await regularFile(briefPath, MAX_BRIEF_BYTES);
  const databaseDigest = await hashFile(databasePath); const briefBuffer = await readFile(briefPath); const briefDigest = sha256(briefBuffer);
  if (databaseInfo.size !== manifest.database.sizeBytes || databaseDigest !== manifest.database.sha256 || briefInfo.size !== manifest.brief.sizeBytes || briefDigest !== manifest.brief.sha256) fail("state_conflict");
  await validateDatabaseBriefBinding(databasePath, briefBuffer.toString("utf8"), manifest);
}

export async function restoreProjectState(options: RestoreProjectStateOptions): Promise<CoreResult<ProjectStateRestoreResult>> {
  if (!options.confirmed) return coreErr("user_confirmation_required");
  let guard: MaintenanceGuard | undefined;
  let stageDatabase: string | undefined; let stageBrief: string | undefined;
  const rollback: { source: string; saved: string; moved: boolean }[] = [];
  let databaseInstalled = false; let briefInstalled = false;
  let committedAndVerified = false;
  try {
    const paths = await pathsFor(options.projectRoot);
    const initial = await validateBundle(paths, options.backupId);
    guard = await MaintenanceGuard.acquire({ databasePath: paths.databasePath, ownerId: `core-restore-${process.pid}`, scope: "restore", busyTimeoutMs: options.maintenanceBusyTimeoutMs });
    const locked = await validateBundle(paths, options.backupId);
    if (locked.manifestBytes !== initial.manifestBytes) fail("state_conflict");

    let preRestoreBackupId: string; let forensicCopyPreserved = false;
    const current = await inspectCurrent(paths);
    if (current.currentState === "healthy") {
      preRestoreBackupId = (await buildBundle(paths, "pre_restore")).manifest.backupId;
    } else {
      preRestoreBackupId = await preserveForensic(paths); forensicCopyPreserved = true;
    }

    const nonce = randomBytes(6).toString("hex");
    stageDatabase = join(paths.dataRoot, `.restore-${nonce}-${DATABASE_FILE}.stage`);
    stageBrief = join(paths.dataRoot, `.restore-${nonce}-${BRIEF_FILE}.stage`);
    await copyFile(locked.databasePath, stageDatabase); await copyFile(locked.briefPath, stageBrief);
    await validateStagedPair(stageDatabase, stageBrief, locked.manifest);
    await options.faultInjection?.afterSourceValidation?.();
    const finalSource = await validateBundle(paths, options.backupId);
    if (finalSource.manifestBytes !== locked.manifestBytes || finalSource.manifest.bindingHash !== locked.manifest.bindingHash) fail("state_conflict");

    for (const source of [paths.databasePath, `${paths.databasePath}-wal`, `${paths.databasePath}-shm`, paths.briefPath]) {
      const exists = await lstat(source).catch(() => undefined);
      const saved = join(paths.dataRoot, `.rollback-${nonce}-${basename(source)}`);
      rollback.push({ source, saved, moved: exists !== undefined });
      if (exists !== undefined) await rename(source, saved);
    }
    await rename(stageDatabase, paths.databasePath); stageDatabase = undefined; databaseInstalled = true;
    await options.faultInjection?.beforeBriefCommit?.();
    await rename(stageBrief, paths.briefPath); stageBrief = undefined; briefInstalled = true;
    await rm(`${paths.databasePath}-wal`, { force: true }); await rm(`${paths.databasePath}-shm`, { force: true });
    await validateStagedPair(paths.databasePath, paths.briefPath, locked.manifest);
    committedAndVerified = true;
    const cleanup = await Promise.allSettled(rollback.filter((item) => item.moved).map(async (item) => {
      await rm(item.saved, { force: true });
    }));
    if (cleanup.some((result) => result.status === "rejected")) fail("infrastructure_failure");
    return coreOk(Object.freeze({
      restored: true as const, backupId: locked.manifest.backupId, projectId: locked.manifest.projectId,
      preRestoreBackupId, forensicCopyPreserved, databaseIntegrity: "ok" as const,
      briefBinding: "matched" as const, networkUsed: false as const,
    }));
  } catch (error) {
    if (committedAndVerified) return coreErr("infrastructure_failure");
    try {
      if (rollback.length > 0) await options.faultInjection?.beforeRollback?.();
      const paths = await pathsFor(options.projectRoot);
      if (databaseInstalled) await rm(paths.databasePath, { force: true });
      if (briefInstalled) await rm(paths.briefPath, { force: true });
      for (const item of [...rollback].reverse()) if (item.moved) await rename(item.saved, item.source);
    } catch { return coreErr("infrastructure_failure"); }
    return resultFor(error);
  } finally {
    if (stageDatabase !== undefined) await rm(stageDatabase, { force: true }).catch(() => undefined);
    if (stageBrief !== undefined) await rm(stageBrief, { force: true }).catch(() => undefined);
    guard?.release();
  }
}
