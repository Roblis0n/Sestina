import { mkdir, realpath, lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  KernelFault,
  kernelRecord,
  kernelText,
  createResearchProject,
} from "@sestina/research";
import { openDatabase } from "@sestina/storage";
import { createResearchStore } from "@sestina/research-store";
import { RandomIdFactory, SystemClock } from "./id-factory.js";
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
  const database = await openDatabase({
    path: join(directory, "state.sqlite"),
  });
  try {
    const clock = new SystemClock();
    const project = createResearchProject(
      {
        title: body.title,
        rootPath: ".",
        source: {
          actor: { kind: "user", actorId: "local-research-owner" },
          authority: "user_recorded",
          recordedAt: clock.now().toISOString(),
        },
      },
      { clock, idFactory: new RandomIdFactory() },
    );
    if (!project.ok) throw new KernelFault("invalid_record");
    const result = createResearchStore(database).projects.create(project.value);
    if (!result.ok) throw new KernelFault("storage_unavailable");
  } finally {
    database.close();
  }
  // On failure, keep the created state and recovery journal for inspection.
  return migrateKernelProject({ projectRoot: root });
}
