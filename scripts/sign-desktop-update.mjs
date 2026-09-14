import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { fileSha256 } from "./lib/desktop-readiness.mjs";
import { assertTargetTagIdentity } from "./lib/target-verification.mjs";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    installer: { type: "string" },
    "private-key": { type: "string" },
    "key-id": { type: "string" },
    output: { type: "string" },
  },
});
if (Object.values(values).length !== 5)
  throw Error("explicit_manifest_installer_key_id_private_key_output_required");
const manifest = JSON.parse(await readFile(resolve(values.manifest), "utf8"));
if (manifest.profile !== "release" || manifest.channel !== "stable")
  throw Error("production_update_requires_release_identity");
assertTargetTagIdentity(
  manifest.publicTag,
  manifest.version,
  execFileSync(
    "git",
    ["rev-parse", `refs/tags/${manifest.publicTag}^{commit}`],
    { encoding: "utf8", windowsHide: true },
  ).trim(),
  manifest.sourceCommit,
);
const status = {
  win32: "authenticode_verified",
  darwin: "signed_notarized_verified",
  linux: "checksum_provenance",
}[manifest.platform];
if (!status || manifest.envelope?.status !== status)
  throw Error("production_update_requires_verified_envelope");
const installer = resolve(values.installer),
  sha256 = fileSha256(installer),
  bytes = await readFile(installer);
if (
  !manifest.envelope.files.some(
    (file) => file.sha256 === sha256 && file.size === bytes.length,
  )
)
  throw Error("update_installer_mismatch");
const key = createPrivateKey(await readFile(resolve(values["private-key"])));
const installedRoot = manifest.update?.roots?.[values["key-id"]];
if (
  key.asymmetricKeyType !== "ed25519" ||
  !installedRoot ||
  !createPublicKey(key)
    .export({ type: "spki", format: "der" })
    .equals(
      createPublicKey(installedRoot).export({ type: "spki", format: "der" }),
    )
)
  throw Error("update_signer_not_installed_root");
const extension = { win32: "exe", darwin: "dmg", linux: "AppImage" }[
  manifest.platform
];
const offer = Object.fromEntries(
  [
    "version",
    "channel",
    "sequence",
    "platform",
    "arch",
    "schema",
    "sourceCommit",
    "migrationSourceSha256",
    "unsignedCoreSha256",
  ].map((name) => [name, manifest[name]]),
);
const artifactPath = `/artifacts/${sha256}/Sestina.${extension}`;
const payload = JSON.stringify({
  ...offer,
  format: "2.0.0",
  sha256,
  size: bytes.length,
  artifactPath,
  signed: true,
});
const envelope = {
  payload,
  keyId: values["key-id"],
  signature: sign(null, Buffer.from(payload), key).toString("base64"),
};
const output = resolve(values.output);
await mkdir(join(output, "artifacts", sha256), { recursive: true });
await cp(installer, join(output, artifactPath.slice(1)), {
  force: false,
  errorOnExist: true,
});
await writeFile(
  join(output, `${manifest.platform}-${manifest.arch}.json`),
  JSON.stringify(envelope, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    created: true,
    sourceCommit: manifest.sourceCommit,
    installerSha256: sha256,
    uploaded: false,
  }),
);
