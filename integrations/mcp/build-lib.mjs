import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const MCP_ROOT = import.meta.dirname;
const REQUIRE_BANNER = "import { createRequire as __sestinaCreateRequire } from 'node:module';\nconst require = __sestinaCreateRequire(import.meta.url);";

export async function buildMcp(outputDirectory = resolve(MCP_ROOT, "dist")) {
  await build({
    entryPoints: ["src/runtime.ts", "src/index.ts"],
    absWorkingDir: MCP_ROOT,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outdir: outputDirectory,
    banner: { js: REQUIRE_BANNER },
    sourcemap: false,
    legalComments: "eof",
  });

  await build({
    entryPoints: ["src/main.ts"],
    absWorkingDir: MCP_ROOT,
    bundle: true,
    external: ["./runtime.js"],
    platform: "node",
    format: "esm",
    target: "node24",
    outdir: outputDirectory,
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: false,
    legalComments: "eof",
  });
  await chmod(resolve(outputDirectory, "main.js"), 0o755);
}
