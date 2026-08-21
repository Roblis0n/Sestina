import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDeterministicTarGzip,
  createDeterministicZip,
  inspectTarGzip,
  inspectZip,
} from "../../scripts/lib/archive.mjs";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("release archive primitives", () => {
  it("emits byte-identical sorted tar.gz and zip archives", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-archive-")); roots.push(root);
    const files = [
      { path: "bundle/中文 readme.txt", data: Buffer.from("offline\n"), mode: 0o644 },
      { path: "bundle/bin/sestina", data: Buffer.from("#!/usr/bin/env node\n"), mode: 0o755 },
    ];
    const tarA = join(root, "a.tar.gz"); const tarB = join(root, "b.tar.gz");
    const zipA = join(root, "a.zip"); const zipB = join(root, "b.zip");
    await createDeterministicTarGzip(tarA, files); await createDeterministicTarGzip(tarB, [...files].reverse());
    await createDeterministicZip(zipA, files); await createDeterministicZip(zipB, [...files].reverse());
    expect(await readFile(tarA)).toEqual(await readFile(tarB));
    expect(await readFile(zipA)).toEqual(await readFile(zipB));
    expect((await inspectTarGzip(tarA)).map((entry) => entry.path)).toEqual(files.map((entry) => entry.path).sort());
    expect((await inspectZip(zipA)).map((entry) => entry.path)).toEqual(files.map((entry) => entry.path).sort());
  });

  it("rejects traversal, absolute, backslash, duplicate and case-colliding paths before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-archive-invalid-")); roots.push(root);
    for (const path of ["../escape", "/absolute", "C:/absolute", "bad\\path"]) {
      await expect(createDeterministicZip(join(root, "bad.zip"), [{ path, data: Buffer.from("x") }])).rejects.toThrow(/unsafe_archive_path/u);
    }
    await expect(createDeterministicTarGzip(join(root, "bad.tgz"), [
      { path: "A.txt", data: Buffer.from("a") },
      { path: "a.txt", data: Buffer.from("b") },
    ])).rejects.toThrow(/archive_path_collision/u);
  });

  it("rejects a tar header checksum mismatch and a zip local/central name mismatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-archive-tamper-")); roots.push(root);
    const tarPath = join(root, "valid.tar.gz"); const zipPath = join(root, "valid.zip");
    await createDeterministicTarGzip(tarPath, [{ path: "bundle/file.txt", data: Buffer.from("safe") }]);
    const tar = gunzipSync(await readFile(tarPath)); tar[0] = (tar[0] ?? 0) ^ 1;
    await writeFile(tarPath, gzipSync(tar, { level: 9, mtime: 0 }));
    await expect(inspectTarGzip(tarPath)).rejects.toThrow(/invalid_tar_checksum/u);

    await createDeterministicZip(zipPath, [{ path: "bundle/file.txt", data: Buffer.from("safe") }]);
    const zip = await readFile(zipPath); zip[30] = (zip[30] ?? 0) ^ 1; await writeFile(zipPath, zip);
    await expect(inspectZip(zipPath)).rejects.toThrow(/invalid_zip_local_entry/u);
  });
});
