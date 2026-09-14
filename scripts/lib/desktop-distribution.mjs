import { createPublicKey } from "node:crypto";
import { isIP } from "node:net";

// Build configuration only. Secrets never enter this public runtime identity.
export function desktopDistribution({
  sourceCommit,
  target,
  version = "0.3.0",
  profile = "candidate",
  tag,
  tagCommit,
  config,
}) {
  if (
    !/^[a-f0-9]{40}$/.test(sourceCommit) ||
    !["win32", "darwin", "linux"].includes(target)
  )
    throw Error("desktop_target_invalid");
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version.split(".").some((n) => Number(n) > 65535)
  )
    throw Error("desktop_version_invalid");
  if (!["candidate", "release"].includes(profile))
    throw Error("desktop_profile_invalid");
  const result = {
    productName: "Sestina",
    appId: "org.sestina.desktop",
    executableName: target === "linux" ? "sestina" : "Sestina",
    // Preserve encryption service identity and existing settings. This is not a second app.
    storageName: "Sestina Candidate",
    profile,
    baseVersion: version,
    version:
      profile === "release"
        ? version
        : `${version}-g10.${sourceCommit.slice(0, 8)}`,
    channel: profile === "release" ? "stable" : "internal_candidate",
    update: { roots: {} },
  };
  if (profile === "candidate") {
    if (config || tag) throw Error("candidate_production_config_refused");
    return result;
  }
  if (tag !== `v${version}`) throw Error("release_tag_required");
  if (tagCommit !== sourceCommit) throw Error("release_tag_source_mismatch");
  if (
    !config?.update?.source ||
    !config.update.roots ||
    !Object.keys(config.update.roots).length
  )
    throw Error("release_update_configuration_required");
  let url;
  try {
    url = new URL(config.update.source);
  } catch {
    throw Error("release_update_source_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    isIP(url.hostname) ||
    url.hostname.includes(":") ||
    !url.hostname.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname)
  )
    throw Error("release_update_source_invalid");
  const roots = {};
  for (const [id, key] of Object.entries(config.update.roots)) {
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
      typeof key !== "string" ||
      key.length > 4096 ||
      !key.startsWith("-----BEGIN PUBLIC KEY-----") ||
      key.includes("PRIVATE")
    )
      throw Error("release_update_root_invalid");
    try {
      if (createPublicKey(key).asymmetricKeyType !== "ed25519") throw Error();
    } catch {
      throw Error("release_update_root_invalid");
    }
    roots[id] = key;
  }
  const signing = config.signing;
  if (
    target === "win32" &&
    !(
      signing?.target === target &&
      typeof signing.certificateFile === "string" &&
      /^[a-f0-9]{64}$/.test(signing.certificateSha256) &&
      /^[a-fA-F0-9]{40}$/.test(signing.thumbprint) &&
      typeof signing.publisherName === "string" &&
      signing.publisherName.length > 0 &&
      signing.passwordEnv === "SESTINA_SIGNING_PASSWORD"
    )
  )
    throw Error("release_signing_configuration_required");
  if (
    target === "darwin" &&
    !(
      signing?.target === target &&
      typeof signing.certificateFile === "string" &&
      /^[a-f0-9]{64}$/.test(signing.certificateSha256) &&
      /^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(
        signing.identity,
      ) &&
      /^[A-Z0-9]{10}$/.test(signing.teamId) &&
      signing.identity.endsWith(`(${signing.teamId})`) &&
      typeof signing.keychainProfile === "string" &&
      signing.keychainProfile.length &&
      signing.passwordEnv === "SESTINA_SIGNING_PASSWORD"
    )
  )
    throw Error("release_signing_configuration_required");
  if (
    target === "linux" &&
    config.linuxPolicy !== "checksum-provenance-signed-update"
  )
    throw Error("release_linux_policy_required");
  result.update = { source: url.href, roots };
  result.publicTag = tag;
  return result;
}

export function desktopExecutable(identity, platform) {
  const name =
    identity.executableName ??
    (platform === "linux" ? "sestina-candidate" : "Sestina Candidate");
  if (
    !["Sestina", "Sestina Candidate", "sestina", "sestina-candidate"].includes(
      name,
    )
  )
    throw Error("desktop_executable_identity_invalid");
  return platform === "win32"
    ? `${name}.exe`
    : platform === "darwin"
      ? `Contents/MacOS/${name}`
      : name;
}
