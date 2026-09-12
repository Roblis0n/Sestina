import { build } from "esbuild";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "sestina-tls-electron-"));
try {
  await writeFile(
    join(directory, "openssl.cnf"),
    "[req]\ndistinguished_name=dn\n[dn]\n",
  );
  execFileSync(
    process.env.SESTINA_TEST_OPENSSL ?? "openssl",
    [
      "req",
      "-config",
      join(directory, "openssl.cnf"),
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-days",
      "1",
    ],
    { stdio: "pipe", windowsHide: true },
  );
  const entry = join(directory, "network.mjs");
  await build({
    entryPoints: [join(root, "tests/desktop/network-probe.ts")],
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["electron", "@primno/dpapi", "@napi-rs/keyring"],
    alias: {
      "@sestina/application": join(root, "packages/application/src/index.ts"),
    },
  });
  const env = {
    ...process.env,
    NODE_EXTRA_CA_CERTS: join(directory, "cert.pem"),
    HTTPS_PROXY: "http://127.0.0.1:1",
    HTTP_PROXY: "http://127.0.0.1:1",
    ALL_PROXY: "http://127.0.0.1:1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = createRequire(join(root, "apps/desktop/package.json"))(
    "electron",
  );
  const code = await new Promise((done, reject) => {
    const child = spawn(executable, [entry, `--fixture=${directory}`], {
      env,
      stdio: "pipe",
      windowsHide: true,
    });
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error("electron_network_timeout"));
    }, 90000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(deadline);
      done(code);
    });
  });
  const report = JSON.parse(
    await readFile(join(directory, "report.json"), "utf8"),
  );
  if (code !== 0 || !report.passed || !report.electron)
    throw new Error(JSON.stringify(report));
  console.log(JSON.stringify(report));
} finally {
  await rm(directory, { recursive: true, force: true });
}
