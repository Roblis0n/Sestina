import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, readdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve, dirname, relative } from "node:path";
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
  plugins: [
    {
      name: "desktop-kernel-entry",
      enforce: "pre",
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html.replace("/src/main.tsx", "/src/desktop-main.tsx"),
      },
      resolveId(source, importer) {
        if (
          importer &&
          source.startsWith(".") &&
          resolve(dirname(importer), source) ===
            join(root, "apps/research-room/client/src/api/client.js")
        )
          return join(
            root,
            "apps/research-room/client/src/api/desktop-client.ts",
          );
      },
      async generateBundle() {
        const inputs = [...this.getModuleIds()]
          .map((path) => relative(root, path).replaceAll("\\", "/"))
          .sort();
        if (
          inputs.some((path) =>
            /(?:\/app\/App\.tsx|\/screens\/(?:ProjectShell|StartCenter|BriefSetup)\.tsx|\/api\/client\.ts|\/RecoveryDialog\.tsx)$/.test(
              path,
            ),
          )
        )
          throw Error("legacy_renderer_in_desktop_bundle");
        await writeFile(
          join(out, "renderer-inputs.json"),
          JSON.stringify(inputs, null, 2),
        );
      },
    },
  ],
  build: { outDir: join(out, "client"), emptyOutDir: true },
});
const runtime = await build({
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
  metafile: true,
});
const emittedInputs = [
  ...new Set(
    Object.values(runtime.metafile.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, contribution]) => contribution.bytesInOutput > 0)
        .map(([path]) => path),
    ),
  ),
].sort();
if (
  emittedInputs.some((path) =>
    /packages\/core\/test\//.test(path.replaceAll("\\", "/")),
  )
)
  throw Error("legacy_runtime_or_test_fixture_in_desktop");
const executableCode = await readFile(join(out, "main.cjs"), "utf8");
if (
  /\b(?:var|class)\s+(?:SestinaCore\d*|ResearchRoomService|DeliberationRoomService|ClosedExternalAppPilotService|CorrectionAppealService|ProjectMemoryService)\b/.test(
    executableCode,
  )
)
  throw Error("legacy_active_service_in_desktop");
await writeFile(
  join(out, "runtime-inputs.json"),
  JSON.stringify(emittedInputs, null, 2),
);
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
