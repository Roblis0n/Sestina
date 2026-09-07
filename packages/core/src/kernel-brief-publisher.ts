import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { withTransaction, type StorageDatabase } from "@sestina/storage";
import {
  kernelBriefDocument,
  readKernelSnapshot,
} from "@sestina/research-store";
import {
  KernelFault,
  kernelBytesHash,
  kernelCanonicalJson,
} from "@sestina/research";

/** The database commits first. Publication failure only leaves a repairable derived view. */
export function publishKernelBriefFile(
  db: StorageDatabase,
  projectId: string,
  inject?: (point: "prepared" | "written" | "installed") => void,
  repairMissing = false,
) {
  const destination = join(dirname(db.path), "research-brief.yaml");
  const prepared = withTransaction(db, () =>
    db.withKernelWrite("workflow", () => {
      const snapshot = readKernelSnapshot(db, projectId);
      const current = db.get<{ data: string }>(
        "SELECT data FROM research_projection_metadata WHERE project_id=? AND projection_kind='brief_file'",
        projectId,
      );
      if (!current) throw new KernelFault("corrupt_state");
      const previous = JSON.parse(current.data) as {
        contentHash?: string;
        pendingContentHash?: string;
      };
      const body = kernelBriefDocument(db, projectId),
        contentHash = kernelBytesHash(body);
      const stat = lstatSync(destination, { throwIfNoEntry: false });
      if (!stat && !repairMissing) throw new KernelFault("relation_mismatch");
      if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_194_304))
        throw new KernelFault("corrupt_state");
      const existing = stat ? kernelBytesHash(readFileSync(destination, "utf8")) : null;
      if (
        existing !== null &&
        ![
          contentHash,
          previous.contentHash,
          previous.pendingContentHash,
        ].includes(existing)
      )
        throw new KernelFault("relation_mismatch");
      db.run(
        "UPDATE research_projection_metadata SET status='rebuilding',version=version+1,data=? WHERE project_id=? AND projection_kind='brief_file'",
        kernelCanonicalJson({
          contentHash: existing ?? previous.contentHash,
          pendingContentHash: contentHash,
          pendingRevision: snapshot.head.revision,
        }),
        projectId,
      );
      return { body, contentHash, revision: snapshot.head.revision, existing };
    }),
  );
  inject?.("prepared");
  const temporary = join(
    dirname(db.path),
    `.brief-publish-${randomUUID()}.tmp`,
  );
  try {
    // Hold the existing database write boundary while installing this exact revision.
    return withTransaction(db, () =>
      db.withKernelWrite("workflow", () => {
        if (
          readKernelSnapshot(db, projectId).head.revision !== prepared.revision
        )
          throw new KernelFault("stale_revision");
        if (
          (prepared.existing === null
            ? lstatSync(destination, { throwIfNoEntry: false }) !== undefined
            : kernelBytesHash(readFileSync(destination, "utf8")) !== prepared.existing)
        )
          throw new KernelFault("relation_mismatch");
        const fd = openSync(temporary, "wx", 0o600);
        try {
          writeFileSync(fd, prepared.body);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        inject?.("written");
        if (prepared.existing === null) {
          // Atomic no-replace installation: a newly appearing unknown file wins.
          linkSync(temporary, destination);
          unlinkSync(temporary);
        } else renameSync(temporary, destination);
        inject?.("installed");
        db.run(
          "UPDATE research_projection_metadata SET source_revision=?,status='ready',version=version+1,data=? WHERE project_id=? AND projection_kind='brief_file'",
          prepared.revision,
          kernelCanonicalJson({ contentHash: prepared.contentHash }),
          projectId,
        );
        return {
          status: "ready" as const,
          sourceProjectStateRevision: prepared.revision,
        };
      }),
    );
  } finally {
    // A failure leaves the uniquely named file discoverable by controlled-copy cleanup.
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
