import { createHash, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve, relative, sep, dirname, isAbsolute } from "node:path";

// Electron's patched fs treats app.asar as a virtual directory. Program recovery
// must copy and hash the physical archive bytes without changing global ASAR state.
const physicalFs: typeof nodeFs = process.versions.electron
  ? (
      createRequire(process.execPath)("original-fs") as {
        promises: typeof nodeFs;
      }
    ).promises
  : nodeFs;
const {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  symlink,
  chmod,
} = physicalFs;
interface RuntimeFile {
  path: string;
  size: number;
  sha256: string;
  link?: string;
  directory?: boolean;
  mode?: number;
}
async function digest(path: string) {
  const file = await open(path, "r");
  const hash = createHash("sha256");
  try {
    for await (const value of file.createReadStream({ autoClose: false })) {
      const bytes: unknown = value;
      if (!Buffer.isBuffer(bytes)) throw Error("update_program_changed");
      hash.update(bytes);
    }
  } finally {
    await file.close();
  }
  return hash.digest("hex");
}
async function directory(path: string) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(path)) !== resolve(path)
  )
    throw Error("update_path_changed");
}
async function inventory(root: string): Promise<RuntimeFile[]> {
  await directory(root);
  const files: RuntimeFile[] = [];
  const ancestors = new Set<string>();
  async function walk(folder: string) {
    const canonical = await realpath(join(root, folder));
    if (ancestors.has(canonical) || ancestors.size >= 64)
      throw Error("update_path_changed");
    ancestors.add(canonical);
    for (const entry of await readdir(join(root, folder), {
      withFileTypes: true,
    })) {
      const name = folder ? `${folder}/${entry.name}` : entry.name;
      if (files.length >= 10000) throw Error("update_size_invalid");
      if (entry.isSymbolicLink()) {
        const path = join(root, name),
          target = await realpath(path),
          rel = relative(root, target);
        if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
          throw Error("update_path_changed");
        if (process.platform === "win32") {
          const info = await stat(target);
          if (info.isDirectory()) await walk(name);
          else if (info.isFile() && info.size <= 2147483648)
            files.push({
              path: name,
              size: info.size,
              sha256: await digest(target),
            });
          else throw Error("update_path_changed");
          continue;
        }
        const link = relative(dirname(path), target).replaceAll(sep, "/");
        files.push({
          path: name,
          size: 0,
          sha256: createHash("sha256").update(link).digest("hex"),
          link,
          directory: (await stat(target)).isDirectory(),
        });
        continue;
      }
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        const path = join(root, name),
          info = await lstat(path);
        if (info.size > 2147483648 || files.length > 10000)
          throw Error("update_size_invalid");
        files.push({
          path: name,
          size: info.size,
          sha256: await digest(path),
          ...(process.platform !== "win32" ? { mode: info.mode & 0o777 } : {}),
        });
      } else throw Error("update_path_changed");
    }
    ancestors.delete(canonical);
  }
  await walk("");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function preserveInstalledProgram(
  source: string,
  managedRoot: string,
  sourceCommit: string,
): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw Error("update_identity_invalid");
  const targetRoot = resolve(managedRoot);
  const rel = relative(resolve(source), targetRoot);
  if (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !/^[A-Za-z]:/.test(rel))
  )
    throw Error("update_path_changed");
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  await directory(targetRoot);
  const destination = join(targetRoot, sourceCommit);
  if (await lstat(destination).catch(() => undefined)) {
    await verifyPreservedProgram(targetRoot, sourceCommit);
    return sourceCommit;
  }
  const temporary = join(targetRoot, `.copy-${randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    const files = await inventory(resolve(source));
    const space = await statfs(targetRoot);
    if (
      files.reduce((sum, f) => sum + f.size, 0) + 67108864 >
      space.bavail * space.bsize
    )
      throw Error("update_space_insufficient");
    await mkdir(join(temporary, "program"));
    for (const file of files) {
      if (file.link !== undefined) continue;
      const target = join(temporary, "program", file.path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await copyFile(join(source, file.path), target);
      if (file.mode !== undefined) await chmod(target, file.mode);
    }
    for (const file of files)
      if (file.link !== undefined) {
        const target = join(temporary, "program", file.path);
        await mkdir(dirname(target), { recursive: true });
        await symlink(
          process.platform === "win32"
            ? resolve(dirname(target), file.link)
            : file.link,
          target,
          file.directory
            ? process.platform === "win32"
              ? "junction"
              : "dir"
            : "file",
        );
      }
    if (
      JSON.stringify(await inventory(join(temporary, "program"))) !==
        JSON.stringify(files) ||
      JSON.stringify(await inventory(resolve(source))) !== JSON.stringify(files)
    )
      throw Error("update_program_changed");
    const handle = await open(join(temporary, "manifest.json"), "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({ format: "1.0.0", sourceCommit, files }),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
    await verifyPreservedProgram(targetRoot, sourceCommit);
    return sourceCommit;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
export async function verifyPreservedProgram(
  managedRoot: string,
  sourceCommit: string,
): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw Error("update_identity_invalid");
  await directory(managedRoot);
  const root = join(managedRoot, sourceCommit);
  await directory(root);
  const file = join(root, "manifest.json"),
    info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4194304)
    throw Error("update_rollback_invalid");
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("update_rollback_invalid");
  const manifest = value as {
    format?: string;
    sourceCommit?: string;
    files?: RuntimeFile[];
  };
  if (
    Object.keys(manifest).sort().join(",") !== "files,format,sourceCommit" ||
    manifest.format !== "1.0.0" ||
    manifest.sourceCommit !== sourceCommit ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    JSON.stringify(await inventory(join(root, "program"))) !==
      JSON.stringify(manifest.files)
  )
    throw Error("update_rollback_invalid");
  return join(root, "program");
}
