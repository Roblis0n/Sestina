import {
  writeFile,
  mkdir,
  readFile,
  mkdtemp,
  rm,
  readdir,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import {
  desktopEvidenceArguments,
  desktopEvidenceOptions,
} from "./lib/target-verification.mjs";

if (process.argv[2] === "--aggregate") {
  if (process.argv.length !== 4) throw Error("aggregate_directory_required");
  const found = [];
  async function findResults(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error("aggregate_symlink_refused");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await findResults(path);
      else if (
        entry.name === "result.json" &&
        /[\\/]verification$/.test(directory)
      )
        found.push(path);
    }
  }
  await findResults(resolve(process.argv[3]));
  if (!found.length) {
    await mkdir(".tmp/desktop-combined", { recursive: true });
    await writeFile(
      ".tmp/desktop-combined/result.json",
      JSON.stringify({
        schema: 1,
        localPassed: false,
        formalAcceptance: "not_established",
        published: false,
        error: "native_platform_results_missing",
      }),
    );
    process.exit(1);
  }
  execFileSync(
    process.execPath,
    [
      resolve("scripts/run-target-gates.mjs"),
      "--phase",
      "final",
      ...found.flatMap((path) => ["--platform-result", path]),
      "--output",
      resolve(".tmp/desktop-combined"),
    ],
    { stdio: "inherit", windowsHide: true },
  );
  process.exit(0);
}

const profile = process.env.DESKTOP_PROFILE ?? "candidate";
const args = [
  resolve("scripts/run-desktop-platform.mjs"),
  "--profile",
  profile,
  "--version",
  process.env.DESKTOP_VERSION ?? "0.3.0",
  "--shared-public",
  resolve(".tmp/shared-public/shared-public.json"),
];
// Explicit, data-only input bundle from the local operator or the authorized
// workflow artifact. No command strings, secrets or arbitrary CLI are accepted.
if (process.env.DESKTOP_INPUT) {
  const inputPath = resolve(process.env.DESKTOP_INPUT);
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const paths = [
    ...desktopEvidenceOptions.filter((key) => key !== "shared-public"),
    "previous-installer",
    "previous-manifest",
    "manifest",
    "installer",
  ];
  if (
    input.schema !== 1 ||
    input.target !== `${process.platform}-${process.arch}` ||
    Object.keys(input).some(
      (key) => !["schema", "target", "run-reinstall", ...paths].includes(key),
    )
  )
    throw Error("desktop_workflow_input_invalid");
  const selected = {};
  for (const key of paths)
    if (input[key] !== undefined) {
      if (
        typeof input[key] !== "string" ||
        !input[key] ||
        isAbsolute(input[key]) ||
        input[key].includes("\\")
      )
        throw Error("workflow_input_relative_path_required");
      const path = resolve(dirname(inputPath), input[key]);
      if (relative(dirname(inputPath), path).startsWith(".."))
        throw Error("workflow_input_path_escape");
      selected[key] = path;
    }
  args.push(...desktopEvidenceArguments(selected));
  for (const key of [
    "previous-installer",
    "previous-manifest",
    "manifest",
    "installer",
  ])
    if (selected[key]) args.push(`--${key}`, selected[key]);
  if (input["run-reinstall"] === true) args.push("--run-reinstall");
  else if (
    input["run-reinstall"] !== undefined &&
    input["run-reinstall"] !== false
  )
    throw Error("workflow_reinstall_boolean_required");
}
let directory;
try {
  if (profile === "release") {
    if (!process.env.SESTINA_RELEASE_CONFIG_JSON || !process.env.DESKTOP_TAG)
      throw Error("explicit_release_resources_missing");
    const privateRoot = resolve(process.env.RUNNER_TEMP ?? ".tmp");
    await mkdir(privateRoot, { recursive: true });
    directory = await mkdtemp(join(privateRoot, "sestina-signing-input-"));
    const config = join(directory, "release.json");
    const parsed = JSON.parse(process.env.SESTINA_RELEASE_CONFIG_JSON);
    if (process.platform !== "linux") {
      if (!process.env.SESTINA_SIGNING_CERTIFICATE_BASE64)
        throw Error("explicit_certificate_missing");
      const certificate = join(directory, "identity.p12");
      await writeFile(
        certificate,
        Buffer.from(process.env.SESTINA_SIGNING_CERTIFICATE_BASE64, "base64"),
        { mode: 0o600, flag: "wx" },
      );
      parsed.signing.certificateFile = certificate;
    }
    if (process.platform === "darwin") {
      if (
        !process.env.SESTINA_NOTARY_KEY_BASE64 ||
        !process.env.SESTINA_NOTARY_KEY_ID ||
        !process.env.SESTINA_NOTARY_ISSUER
      )
        throw Error("explicit_notarization_resources_missing");
      const key = join(directory, "notary.p8");
      await writeFile(
        key,
        Buffer.from(process.env.SESTINA_NOTARY_KEY_BASE64, "base64"),
        { mode: 0o600, flag: "wx" },
      );
      execFileSync(
        "xcrun",
        [
          "notarytool",
          "store-credentials",
          parsed.signing.keychainProfile,
          "--key",
          key,
          "--key-id",
          process.env.SESTINA_NOTARY_KEY_ID,
          "--issuer",
          process.env.SESTINA_NOTARY_ISSUER,
        ],
        { stdio: "pipe" },
      );
    }
    await writeFile(config, JSON.stringify(parsed), {
      mode: 0o600,
      flag: "wx",
    });
    args.push("--tag", process.env.DESKTOP_TAG, "--release-config", config);
    if (
      !process.env.SESTINA_UPDATE_PRIVATE_KEY_BASE64 ||
      !process.env.SESTINA_UPDATE_KEY_ID
    )
      throw Error("explicit_production_update_signer_missing");
    const updateKey = join(directory, "update.pem");
    await writeFile(
      updateKey,
      Buffer.from(process.env.SESTINA_UPDATE_PRIVATE_KEY_BASE64, "base64"),
      { mode: 0o600, flag: "wx" },
    );
    args.push(
      "--update-private-key",
      updateKey,
      "--update-key-id",
      process.env.SESTINA_UPDATE_KEY_ID,
    );
  }
  if (process.platform === "linux")
    execFileSync("xvfb-run", ["-a", process.execPath, ...args], {
      stdio: "inherit",
    });
  else
    execFileSync(process.execPath, args, {
      stdio: "inherit",
      windowsHide: true,
    });
} finally {
  // mkdtemp created this exact private directory for this invocation only.
  if (directory) await rm(directory, { recursive: true, force: true });
}
