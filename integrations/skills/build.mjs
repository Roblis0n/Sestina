import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  absWorkingDir: import.meta.dirname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/index.js",
  sourcemap: false,
  legalComments: "eof",
});
