#!/usr/bin/env node
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outdir = resolve(root, "apps/research-room/dist");
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: {
    main: resolve(root, "apps/research-room/src/main.ts"),
    server: resolve(root, "apps/research-room/src/server.ts"),
  },
  outdir,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "bundle",
  // Native secure-storage bindings must stay runtime-loaded. Bundling their
  // JavaScript shims makes esbuild traverse platform-specific `.node` files
  // and either fail the build or produce a non-portable artifact.
  external: ["@napi-rs/keyring", "@napi-rs/keyring/*", "@primno/dpapi", "@primno/dpapi/*"],
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
});
