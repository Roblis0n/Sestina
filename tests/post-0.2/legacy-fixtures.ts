import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import provenance from "./legacy-provenance.json" with { type: "json" };

export async function oldCorpus() {
  await mkdir(resolve(".tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".tmp/sestina-pinned-old-"));
  execFileSync(process.execPath, [resolve("scripts/materialize-post-0.2-legacy.mjs"), root], { windowsHide: true, stdio: "pipe", maxBuffer: 2_097_152 });
  return { root, async project(schema: number) {
    const source = join(root, `schema-${schema}`, ".sestina");
    const entry = provenance.fixtures.find((f) => f.schema === schema)!;
    const hash = createHash("sha256").update(await readFile(join(source, "state.sqlite"))).digest("hex");
    if (hash !== entry.databaseSha256) throw new Error("immutable_old_sample_mismatch");
    const projectRoot = await mkdtemp(join(tmpdir(), "sestina-g2-copy-")); await cp(source, join(projectRoot, ".sestina"), { recursive: true });
    return { root: projectRoot, entry, async cleanup() { await rm(projectRoot, { recursive: true, force: true }); } };
  }, async cleanup() { await rm(root, { recursive: true, force: true }); } };
}
