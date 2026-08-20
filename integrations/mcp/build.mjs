import { build } from "esbuild";

await build({
  entryPoints: ["src/runtime.ts", "src/index.ts"],
  absWorkingDir: import.meta.dirname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outdir: "dist",
  banner: { js: "import { createRequire as __sestinaCreateRequire } from 'node:module';\nconst require = __sestinaCreateRequire(import.meta.url);" },
  sourcemap: false,
  legalComments: "eof",
});

await build({
  entryPoints: ["src/main.ts"],
  absWorkingDir: import.meta.dirname,
  bundle: true,
  external: ["./runtime.js"],
  platform: "node",
  format: "esm",
  target: "node24",
  outdir: "dist",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  legalComments: "eof",
});
