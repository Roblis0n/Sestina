#!/usr/bin/env node
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildMcp } from "../integrations/mcp/build-lib.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appRequire = createRequire(resolve(root, "apps/research-room/package.json"));
const { build: buildClient } = await import(pathToFileURL(appRequire.resolve("vite")).href);
const outdir = resolve(root, "apps/research-room/dist");
const coreProviderSecrets = resolve(root, "packages/core/src/provider-secrets.ts");
const productionSecretBackendPlugin = {
  name: "sestina-production-secret-backend",
  setup(buildContext) {
    buildContext.onLoad(
      { filter: /provider-secrets\.ts$/ },
      (args) => {
        if (resolve(args.path) !== coreProviderSecrets) return null;
        return {
          contents: 'export { createSecretBackend } from "@sestina/secrets";\n',
          loader: "ts",
          resolveDir: resolve(root, "packages/core/src"),
        };
      },
    );
  },
};
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await buildClient({ configFile: resolve(root, "apps/research-room/vite.config.ts") });
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
  plugins: [productionSecretBackendPlugin],
  // Native secure-storage bindings must stay runtime-loaded. Bundling their
  // JavaScript shims makes esbuild traverse platform-specific `.node` files
  // and either fail the build or produce a non-portable artifact.
  external: ["@napi-rs/keyring", "@napi-rs/keyring/*", "@primno/dpapi", "@primno/dpapi/*"],
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
});
await mkdir(resolve(outdir, "mcp"), { recursive: true });
await buildMcp(resolve(outdir, "mcp"));
