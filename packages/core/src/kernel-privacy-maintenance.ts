import { verifyManagedRecoveryBundle } from "./recovery.js";
import { lstat, readdir, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  MaintenanceGuard,
  hashFile,
  withTransaction,
  type StorageDatabase,
} from "@sestina/storage";
import { readKernelSnapshot } from "@sestina/research-store";
import {
  KernelFault,
  kernelHash,
  kernelCanonicalJson,
  kernelRecord,
  kernelText,
  kernelInteger,
} from "@sestina/research";

export interface CopyFile {
  locationToken: string;
  contentHash: string;
}
export interface CleanupPlan {
  projectId: string;
  sourceRevision: number;
  files: CopyFile[];
  blocked: string[];
  planHash: string;
}
const pendingId = "kernel-privacy-cleanup";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function savedPlan(raw: string): CleanupPlan {
  const value: unknown = JSON.parse(raw);
  const parent = kernelRecord(value, ["plan", "completed", "pagesPurged", "restoresBlocked", "externalCopies", "copyAction"]);
  const plan = kernelRecord(parent.plan, ["projectId", "sourceRevision", "files", "blocked", "planHash"]);
  kernelText(plan.projectId,160); kernelInteger(plan.sourceRevision); kernelText(plan.planHash,64);
  if (!Array.isArray(plan.files) || plan.files.length>10000 || !Array.isArray(plan.blocked) || plan.blocked.length>10000) throw new KernelFault("corrupt_state");
  for(const entry of plan.files) { const file=kernelRecord(entry,["locationToken","contentHash"]);kernelText(file.locationToken,4096);kernelText(file.contentHash,64); }
  for(const entry of plan.blocked) kernelText(entry,4096);
  const plannedFiles=plan.files;
  if(!Array.isArray(parent.completed) || parent.completed.length>10000 || parent.completed.some(entry=>typeof entry!=="string" || !plannedFiles.some(file=>(file as CopyFile).locationToken===entry))) throw new KernelFault("corrupt_state");
  if(typeof parent.pagesPurged!=="boolean" || parent.restoresBlocked!==true || parent.externalCopies!=="not_controlled" || (parent.copyAction!==undefined && parent.copyAction!=="delete" && parent.copyAction!=="retire")) throw new KernelFault("corrupt_state");
  return plan as unknown as CleanupPlan;
}

async function safeFile(root: string, token: string): Promise<string> {
  if (
    !token ||
    token.includes("\\") ||
    token.split("/").some((v) => !v || v === "." || v === "..")
  )
    throw new KernelFault("invalid_record");
  const target = resolve(root, ...token.split("/"));
  if (!target.startsWith(root + sep))
    throw new KernelFault("relation_mismatch");
  let path = root;
  for (const part of token.split("/")) {
    path = join(path, part);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new KernelFault("relation_mismatch");
  }
  if (!(await lstat(target)).isFile() || (await realpath(target)) !== target)
    throw new KernelFault("relation_mismatch");
  return target;
}
async function directoryFiles(
  root: string,
  directory: string,
): Promise<CopyFile[]> {
  const result: CopyFile[] = [];
  async function walk(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new KernelFault("relation_mismatch");
    if (stat.isDirectory())
      for (const entry of await readdir(path)) await walk(join(path, entry));
    else {
      const token = relative(root, path).split(sep).join("/");
      result.push({
        locationToken: token,
        contentHash: await hashFile(await safeFile(root, token)),
      });
      if (result.length > 10_000) throw new KernelFault("invalid_record");
    }
  }
  try {
    await walk(directory);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return result;
}
export async function inspectKernelPrivacyCopies(
  db: StorageDatabase,
  projectId: string,
): Promise<CleanupPlan> {
  const snapshot = readKernelSnapshot(db, projectId),
    root = await realpath(dirname(db.path));
  const files: CopyFile[] = [],
    blocked: string[] = [];
  for (const run of db.all<{ run_id: string }>(
    "SELECT run_id FROM research_migration_runs WHERE project_id=?",
    projectId,
  )) {
    if (!uuid.test(run.run_id)) throw new KernelFault("corrupt_state");
    for (const folder of ["backup", "original", "staging"])
      files.push(
        ...(await directoryFiles(
          root,
          join(root, "kernel-migrations", run.run_id, folder),
        )),
      );
  }
  for (const area of ["manual", "forensic"]) {
    const base = join(root, "backups", area);
    let entries: string[];
    try {
      if ((await lstat(base)).isSymbolicLink())
        throw new KernelFault("relation_mismatch");
      entries = await readdir(base);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    for (const id of entries) {
      const token = `backups/${area}/${id}`;
      try {
        const entries = await directoryFiles(root, join(base, id));
        if (entries.length === 0) continue;
        const manifestFile = await safeFile(root, `${token}/manifest.json`);
        if ((await lstat(manifestFile)).size > 65_536)
          throw new KernelFault("invalid_record");
        const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
          projectId: string;
          backupId: string;
        };
        if (
          manifest.projectId !== projectId ||
          manifest.backupId !== id ||
          !/^(?:bkp|pre|upg)_\d{8}T\d{9}Z_[0-9a-f]{12}$/.test(id)
        )
          throw new KernelFault("relation_mismatch");
        if (area !== "manual") throw new KernelFault("relation_mismatch");
        const verified = await verifyManagedRecoveryBundle(dirname(root), id);
        if (verified.projectId !== projectId) throw new KernelFault("relation_mismatch");
        files.push(...entries);
      } catch {
        blocked.push(token);
      }
    }
  }
  for (const name of await readdir(root)) {
    if (/^\.brief-publish-[a-f0-9-]{36}\.tmp$/.test(name))
      files.push({
        locationToken: name,
        contentHash: await hashFile(await safeFile(root, name)),
      });
  }
  files.sort((a, b) => a.locationToken.localeCompare(b.locationToken));
  blocked.sort();
  const body = {
    projectId,
    sourceRevision: snapshot.head.revision,
    files,
    blocked,
  };
  return { ...body, planHash: kernelHash(body) };
}

export function kernelPrivacyCleanupStatus(
  db: StorageDatabase,
  projectId: string,
) {
  const row = db.get<{ status: string; data: string; source_revision: number }>(
    "SELECT status,data,source_revision FROM research_copy_inventory WHERE project_id=? AND copy_id=?",
    projectId,
    pendingId,
  );
  const forgotten = db.get<{ revision: number | null }>(
    "SELECT MAX(source_revision) revision FROM research_privacy_redactions WHERE project_id=? AND source_revision>1",
    projectId,
  )?.revision;
  return {
    status:
      row && ["removed","retained"].includes(row.status) && row.source_revision >= (forgotten ?? 0)
        ? row.status === "retained" ? "complete_retained" : "complete"
        : forgotten
          ? "cleanup_required"
          : "not_required",
    details: row ? (JSON.parse(row.data) as unknown) : null,
    externalCopies: "not_controlled",
    previouslySentContent: "cannot_recall",
  };
}

/** Explicit cleanup after Forget: failures leave the committed tombstone and a resumable file list. */
export async function cleanupKernelPrivacyCopies(
  db: StorageDatabase,
  projectId: string,
  planHash: string,
  resume = false,
  fault?: (token: string) => void,
  copyAction: "delete" | "retire" = "delete",
) {
  if (
    !db.get(
      "SELECT 1 FROM research_privacy_redactions WHERE project_id=? AND source_revision>1",
      projectId,
    )
  )
    throw new KernelFault("illegal_transition");
  const guard = await MaintenanceGuard.acquire({
    databasePath: db.path,
    scope: "retention",
    ownerId: "kernel-privacy-cleanup",
  });
  db.maintenanceOwned = true;
  try {
    if(!["delete","retire"].includes(copyAction)) throw new KernelFault("invalid_record");
    const previous = db.get<{ data: string }>(
      "SELECT data FROM research_copy_inventory WHERE project_id=? AND copy_id=?",
      projectId,
      pendingId,
    );
    const plan: CleanupPlan =
      resume && previous
        ? savedPlan(previous.data)
        : await inspectKernelPrivacyCopies(db, projectId);
    if(resume && previous && ((JSON.parse(previous.data) as {copyAction?:string}).copyAction ?? "delete")!==copyAction) throw new KernelFault("stale_object");
    if (
      plan.planHash !== planHash ||
      plan.projectId !== projectId ||
      plan.blocked.length
    )
      throw new KernelFault("stale_object");
    const { planHash: savedHash, ...body } = plan;
    if (
      kernelHash(body) !== savedHash ||
      plan.files.length > 10_000 ||
      plan.files.some(
        (file) =>
          !/^(?:kernel-migrations\/[a-f0-9-]{36}\/(?:backup|original|staging)\/|backups\/(?:manual|forensic)\/|\.brief-publish-[a-f0-9-]{36}\.tmp$)/.test(
            file.locationToken,
          ),
      )
    )
      throw new KernelFault("corrupt_state");
    const root = await realpath(dirname(db.path));
    const save = (status: "unverified" | "removed" | "retained", completed: string[]) => {
      withTransaction(db, () => {
        db.withKernelWrite("workflow", () => {
          db.run(
            "INSERT INTO research_copy_inventory(copy_id,project_id,copy_kind,location_token,source_revision,content_hash,status,created_at,data) VALUES(?,?,'temporary','controlled_privacy_cleanup',?,?,?,datetime('now'),?) ON CONFLICT(copy_id) DO UPDATE SET status=excluded.status,data=excluded.data,source_revision=excluded.source_revision,content_hash=excluded.content_hash",
            pendingId,
            projectId,
            plan.sourceRevision,
            plan.planHash,
            status,
            kernelCanonicalJson({
              plan,
              completed,
              copyAction,
              pagesPurged: status !== "unverified",
              restoresBlocked: true,
              externalCopies: "not_controlled",
            }),
          );
        });
      });
    };
    const completed: string[] =
      resume && previous
        ? (JSON.parse(previous.data) as { completed: string[] }).completed
        : [];
    save("unverified", completed);
    for (const file of plan.files) {
      try {
        const target = await safeFile(root, file.locationToken);
        if ((await hashFile(target)) !== file.contentHash)
          throw new KernelFault("stale_object");
        fault?.(file.locationToken);
        if(copyAction === "delete" || file.locationToken.startsWith(".brief-publish-")) await unlink(target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT" || copyAction === "retire") throw e;
      }
      if (!completed.includes(file.locationToken))
        completed.push(file.locationToken);
      save("unverified", completed);
    }
    db.purgeKernelFreePages();
    // This final record contains only hashes and cleanup facts. The old frames
    // have already been removed; no second rewrite of canonical data is needed.
    withTransaction(db, () => { db.withKernelWrite("workflow", () => {
      for (const row of db.all<{copy_id:string;location_token:string;data:string}>("SELECT copy_id,location_token,data FROM research_copy_inventory WHERE project_id=? AND copy_kind='pre_migration_backup'", projectId)) {
        if (!plan.files.some(file => file.locationToken.startsWith(`kernel-migrations/${row.location_token}/backup/`))) continue;
        db.run("UPDATE research_copy_inventory SET status=?,data=? WHERE project_id=? AND copy_id=?", copyAction === "delete" ? "removed" : "retained", kernelCanonicalJson({ ...JSON.parse(row.data), privacyPlanHash: plan.planHash, copyAction, restoresBlocked:true }), projectId,row.copy_id);
      }
    }); });
    save(copyAction === "delete" ? "removed" : "retained", completed);
    return kernelPrivacyCleanupStatus(db, projectId);
  } finally {
    db.maintenanceOwned = false;
    guard.release();
  }
}
