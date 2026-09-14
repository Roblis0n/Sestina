import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";

export async function verifyDesktopEnvelope({
  target,
  output,
  artifacts,
  distribution,
  signing,
}) {
  const files = artifacts.filter((file) =>
    /\.(?:exe|dmg|AppImage)$/.test(file),
  );
  if (!files.length) throw Error("desktop_installer_missing");
  const records = [];
  for (const file of files) {
    const bytes = await readFile(file);
    records.push({
      name: basename(file),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    });
  }
  if (distribution.profile !== "release")
    return { status: "unsigned_candidate", files: records };
  if (target !== process.platform)
    throw Error("signing_requires_native_target");
  if (target === "win32") {
    for (const file of [...files, join(output, "win-unpacked/Sestina.exe")]) {
      const result = JSON.parse(
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$s = Get-AuthenticodeSignature -LiteralPath $env:SESTINA_VERIFY_SIGNED_FILE; @{status=[string]$s.Status; thumbprint=$s.SignerCertificate.Thumbprint} | ConvertTo-Json -Compress",
          ],
          {
            windowsHide: true,
            encoding: "utf8",
            env: { ...process.env, SESTINA_VERIFY_SIGNED_FILE: file },
          },
        ),
      );
      if (
        result.status !== "Valid" ||
        result.thumbprint?.toLowerCase() !== signing.thumbprint.toLowerCase()
      )
        throw Error("release_authenticode_invalid");
    }
    return {
      status: "authenticode_verified",
      signer: signing.thumbprint.toUpperCase(),
      files: records,
    };
  }
  if (target === "darwin") {
    const app = join(output, "mac-arm64/Sestina.app");
    const run = (command, args) =>
      execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
    run("xcrun", ["stapler", "validate", app]);
    for (const file of files) run("hdiutil", ["verify", file]);
    return {
      status: "signed_notarized_verified",
      signer: signing.identity,
      files: records,
    };
  }
  return {
    status: "checksum_provenance",
    policy:
      "AppImage provenance and checksums; Ed25519-signed update metadata required separately",
    files: records,
  };
}
