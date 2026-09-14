import { execFileSync } from "node:child_process";
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileSha256 } from "./lib/desktop-readiness.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(process.argv[2]);
const first = JSON.parse(await readFile(manifestPath, "utf8"));
if (first.platform !== process.platform || first.arch !== process.arch)
  throw Error("reproducibility_target_mismatch");
if (
  fileSha256(join(dirname(manifestPath), "unsigned-core.tar.gz")) !==
  first.unsignedCoreSha256
)
  throw Error("original_core_hash_mismatch");
const base = join(root, ".tmp/desktop-reproducibility");
await mkdir(base, { recursive: true });
const output = await mkdtemp(join(base, "independent-"));
// A fresh compilation and staging tree; never copy the first core as a second result.
execFileSync(
  process.execPath,
  [
    join(root, "scripts/package-desktop.mjs"),
    process.platform,
    "--profile",
    first.profile ?? "candidate",
    "--version",
    first.baseVersion ?? first.version.split("-")[0],
    ...(first.profile === "release"
      ? [
          "--tag",
          first.publicTag,
          "--release-config",
          process.env.SESTINA_RELEASE_CONFIG ?? "",
        ]
      : []),
    "--core-only",
    "--output",
    output,
  ],
  { cwd: root, windowsHide: true, stdio: "inherit" },
);
const second = JSON.parse(
  await readFile(join(output, "candidate-manifest.json"), "utf8"),
);
const secondHash = fileSha256(join(output, "unsigned-core.tar.gz"));
if (
  second.sourceCommit !== first.sourceCommit ||
  second.sourceTree !== first.sourceTree ||
  second.lockSha256 !== first.lockSha256 ||
  second.buildNode !== first.buildNode ||
  second.unsignedCoreSha256 !== secondHash ||
  secondHash !== first.unsignedCoreSha256 ||
  JSON.stringify(second.files) !== JSON.stringify(first.files)
)
  throw Error("independent_core_build_mismatch");
console.log(
  JSON.stringify({
    passed: true,
    checks: [
      "first-core-matches-manifest",
      "independent-compilation-same-source-and-toolchain",
      "unsigned-core-and-all-entries-identical",
    ],
    sourceCommit: first.sourceCommit,
    sha256: secondHash,
    independentOutput: output,
    signedOuterComparison: "not_applicable_unsigned_candidate",
  }),
);
