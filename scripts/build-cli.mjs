import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { SESTINA_RELEASE_IDENTITY } from "../packages/schema/src/release-contract.mjs";
import { buildMcp } from "../integrations/mcp/build-lib.mjs";

const root = resolve(import.meta.dirname, "../apps/cli");
const outputDirectory = resolve(root, "dist");
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(resolve(outputDirectory, "mcp"), { recursive: true });

await build({
  entryPoints: ["src/main.ts"],
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: resolve(outputDirectory, "cli.js"),
  banner: {
    js: "import { createRequire as __sestinaCreateRequire } from 'node:module';\nconst require = __sestinaCreateRequire(import.meta.url);",
  },
  sourcemap: false,
  legalComments: "eof",
});

await buildMcp(resolve(outputDirectory, "mcp"));

const identity = JSON.stringify(SESTINA_RELEASE_IDENTITY);
const wrapper = `#!/usr/bin/env node
const identity = Object.freeze(${identity});
const args = process.argv.slice(2);
if (args.length >= 1 && args[0] === "--version" && args.every((value) => value === "--version" || value === "--json")) {
  if (args.filter((value) => value === "--version").length !== 1 || args.filter((value) => value === "--json").length > 1) {
    process.stderr.write("Error: Version arguments are invalid.\\n");
    process.exitCode = 2;
  } else if (args.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: true, command: "version", ...identity }) + "\\n");
  } else {
    process.stdout.write(identity.cliPackage + " " + identity.version + " (" + identity.releaseBuildId + ")\\n");
  }
} else {
  const { runProcessCli } = await import("./cli.js");
  process.exitCode = await runProcessCli(args);
}
`;
await writeFile(resolve(outputDirectory, "main.js"), wrapper, { encoding: "utf8", mode: 0o755 });
await chmod(resolve(outputDirectory, "main.js"), 0o755);
