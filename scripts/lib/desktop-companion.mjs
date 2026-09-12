import { createRequire } from "node:module";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { buildMcp } from "../../integrations/mcp/build-lib.mjs";
export async function buildDesktopCompanion(
  root,
  out,
  platform = process.platform,
  arch = process.arch,
) {
  if (out !== join(root, "apps/desktop/dist"))
    throw Error("desktop_output_path_invalid");
  const native = join(out, "node_modules");
  await rm(native, { recursive: true, force: true });
  await rm(join(out, "companion"), { recursive: true, force: true });
  const secrets = createRequire(join(root, "packages/secrets/package.json"));
  async function files(name, from, names) {
    for (const namePart of names) {
      const to = join(native, name, namePart);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(from, namePart), to);
    }
  }
  if (platform === "win32") {
    const source = dirname(secrets.resolve("@primno/dpapi/package.json"));
    await files("@primno/dpapi", source, [
      "package.json",
      "LICENSE",
      "dist/index.js",
      `prebuilds/win32-${arch}/@primno+dpapi.node`,
    ]);
    const loader = dirname(
      createRequire(join(source, "package.json")).resolve(
        "node-gyp-build/package.json",
      ),
    );
    await files("node-gyp-build", loader, [
      "package.json",
      "LICENSE",
      "index.js",
      "node-gyp-build.js",
    ]);
  } else {
    const source = dirname(secrets.resolve("@napi-rs/keyring/package.json"));
    await files("@napi-rs/keyring", source, [
      "package.json",
      "LICENSE",
      "index.js",
      "keytar.js",
    ]);
    const name = `@napi-rs/keyring-${platform}-${arch}${platform === "linux" ? "-gnu" : ""}`;
    const binary = dirname(
      createRequire(join(source, "package.json")).resolve(
        `${name}/package.json`,
      ),
    );
    await files(
      name,
      binary,
      (await readdir(binary)).filter(
        (n) => n === "package.json" || n.endsWith(".node") || n === "README.md",
      ),
    );
  }
  // The companion is outside ASAR so a host can launch its own bounded Node
  // process without Electron RUN_AS_NODE or a development installation.
  const companion = join(out, "companion");
  await mkdir(companion, { recursive: true });
  await buildMcp(companion);
  await writeFile(
    join(companion, "package.json"),
    JSON.stringify({ type: "module", private: true }),
  );
  const runtime = process.env.SESTINA_COMPANION_NODE ?? process.execPath;
  if (platform !== process.platform || arch !== process.arch) {
    if (!process.env.SESTINA_COMPANION_NODE)
      throw Error("target_companion_node_required");
  }
  if (process.versions.node !== "24.13.0")
    throw Error("companion_build_node_version_mismatch");
  const executable = platform === "win32" ? "node.exe" : "node";
  await copyFile(runtime, join(companion, executable));
  await chmod(join(companion, executable), 0o755);
  await copyFile(
    join(root, "docs/release/NODE-RUNTIME-LICENSE.txt"),
    join(companion, "NODE-LICENSE.txt"),
  );
  await writeFile(
    join(companion, "runtime-identity.json"),
    JSON.stringify({
      version: "24.13.0",
      platform,
      arch,
      sha256: createHash("sha256")
        .update(await readFile(runtime))
        .digest("hex"),
    }),
  );
  await cp(
    join(root, "integrations/skills/hosts/codex"),
    join(companion, "skills"),
    { recursive: true },
  );
  if (platform === "win32")
    await writeFile(
      join(companion, "sestina-mcp.cmd"),
      '@echo off\r\n"%~dp0node.exe" "%~dp0main.js" %*\r\n',
    );
  else {
    await writeFile(
      join(companion, "sestina-mcp"),
      '#!/bin/sh\nSELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$SELF_DIR/node" "$SELF_DIR/main.js" "$@"\n',
    );
    await chmod(join(companion, "sestina-mcp"), 0o755);
  }
}
