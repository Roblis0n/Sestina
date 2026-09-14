import { writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

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
if (profile === "release") {
  if (!process.env.SESTINA_RELEASE_CONFIG_JSON || !process.env.DESKTOP_TAG)
    throw Error("explicit_release_resources_missing");
  const directory = join(
    process.env.RUNNER_TEMP ?? resolve(".tmp"),
    "sestina-signing-input",
  );
  await mkdir(directory, { recursive: true });
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
  await writeFile(config, JSON.stringify(parsed), { mode: 0o600, flag: "wx" });
  args.push("--tag", process.env.DESKTOP_TAG, "--release-config", config);
}
if (process.platform === "linux")
  execFileSync("xvfb-run", ["-a", process.execPath, ...args], {
    stdio: "inherit",
  });
else
  execFileSync(process.execPath, args, { stdio: "inherit", windowsHide: true });
