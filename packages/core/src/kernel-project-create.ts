import { mkdir, realpath, lstat } from "node:fs/promises";
import { join } from "node:path";
import { KernelFault, kernelRecord, kernelText } from "@sestina/research";
import { openSestina } from "./sestina-core.js";
import { migrateKernelProject } from "./kernel-migration.js";

/** Bootstrap only. Initial research content still enters through a user-confirmed Review. */
export async function createKernelProject(input: unknown) {
  const body = kernelRecord(input, ["projectPath", "title", "confirmed"]);
  kernelText(body.projectPath, 4096);
  kernelText(body.title, 200);
  if (body.confirmed !== true) throw new KernelFault("authority_required");
  const root = await realpath(body.projectPath);
  if (!(await lstat(root)).isDirectory())
    throw new KernelFault("invalid_record");
  const directory = join(root, ".sestina");
  // Exclusive creation preserves every unknown, existing, or interrupted project.
  await mkdir(directory);
  const opened = await openSestina({
    databasePath: join(directory, "state.sqlite"),
  });
  if (!opened.ok) throw new KernelFault("storage_unavailable");
  try {
    const result = opened.value.initializeProject({
      title: body.title,
      rootPath: ".",
      actor: { kind: "user", actorId: "local-research-owner" },
    });
    if (!result.ok) throw new KernelFault("storage_unavailable");
  } finally {
    opened.value.close();
  }
  // On failure, keep the created state and recovery journal for inspection.
  return migrateKernelProject({ projectRoot: root });
}
