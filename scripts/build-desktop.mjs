import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, readdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDesktopCompanion } from "./lib/desktop-companion.mjs";
const root = resolve(import.meta.dirname, "..");
const app = join(root, "apps/desktop"),
  out = join(app, "dist");
await mkdir(out, { recursive: true });
const roomRequire = createRequire(
  join(root, "apps/research-room/package.json"),
);
const { build: viteBuild } = await import(
  pathToFileURL(roomRequire.resolve("vite")).href
);
await viteBuild({
  configFile: join(root, "apps/research-room/vite.config.ts"),
  build: { outDir: join(out, "client"), emptyOutDir: true },
});
await build({
  entryPoints: {
    main: join(app, "src/main.ts"),
    preload: join(app, "src/preload.ts"),
  },
  outdir: out,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  // Native adapters must use this CommonJS entry's installed module.paths;
  // ESM dynamic import would ignore it and lose unpacked native resources.
  supported: { "dynamic-import": false },
  external: ["electron", "@primno/dpapi", "@napi-rs/keyring"],
  plugins: [
    {
      name: "desktop-core-secret-adapter",
      setup(context) {
        context.onLoad({ filter: /provider-secrets\.ts$/ }, async (args) => {
          if (
            resolve(args.path) !==
            join(root, "packages/core/src/provider-secrets.ts")
          )
            return null;
          return {
            contents: (await readFile(args.path, "utf8")).replace(
              "import(SECURE_STORAGE_PACKAGE)",
              'import("@sestina/secrets")',
            ),
            loader: "ts",
            resolveDir: join(root, "packages/core/src"),
          };
        });
      },
    },
  ],
  sourcemap: false,
});
const assets = {};
async function scan(relative = "") {
  for (const entry of await readdir(join(out, "client", relative), {
    withFileTypes: true,
  })) {
    const name = relative + entry.name;
    if (entry.isDirectory()) await scan(name + "/");
    else if (entry.isFile() && /\.(html|js|css|png|woff2)$/.test(name))
      assets["/" + name] = name;
    else throw new Error("Unapproved desktop asset");
  }
}
await scan();
await writeFile(
  join(out, "assets.json"),
  JSON.stringify(assets, null, 2) + "\n",
);
await buildDesktopCompanion(
  root,
  out,
  process.argv[2] ?? process.platform,
  process.argv[3] ?? process.arch,
);
