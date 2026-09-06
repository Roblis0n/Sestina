import { it, expect } from "vitest";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SESTINA_RELEASE_IDENTITY as identity } from "../../../packages/schema/src/release-contract.mjs";
import { validateReleaseManifest } from "../../../scripts/lib/release-verifier.mjs";
import {
  SyntheticProvider,
  syntheticProject,
  USER,
  value,
} from "../factory.js";
import type { ResearchRoomSemanticJudgeRequest } from "@sestina/review";

class ChallengedProvider extends SyntheticProvider {
  override async analyze(
    request: ResearchRoomSemanticJudgeRequest,
  ): Promise<unknown> {
    const response = (await super.analyze(request)) as {
      assessments: { criterionId: string; verdict: string }[];
    };
    return {
      ...response,
      assessments: response.assessments.map((a) => ({
        ...a,
        verdict: a.criterionId === "argument-leap" ? "positive" : a.verdict,
      })),
    };
  }
}
it("P2-01 G7: resolving an interpretation challenge must lead to the unified Review effect path", async () => {
  const s = await syntheticProject(new ChallengedProvider());
  try {
    const p = s.prepare(),
      analyzed = value(
        await s.core.analyzeResearchRoomSuggestion({
          reviewId: p.reviewId,
          confirmationNonce: p.confirmationNonce,
          manifestHash: p.manifestHash,
        }),
      );
    const receipt = value(
      s.core.commitResearchRoomDisposition({
        projectId: s.projectId,
        reviewId: analyzed.reviewId,
        authorityNonce: analyzed.authorityNonce,
        expectedStateBinding: analyzed.stateBinding,
        disposition: "deferred",
        reason: "Synthetic challenge source.",
        actor: USER,
      }),
    );
    const finding = receipt.semanticJudge?.findings.find(
      (f) => f.kind === "argument_leap",
    );
    expect(finding).toBeDefined();
    let appeal = value(
      s.core.createCorrectionAppeal({
        projectId: s.projectId,
        receiptId: receipt.id,
        findingId: finding!.id,
        actor: USER,
        statement: {
          disagreement: "Synthetic disagreement.",
          challengedCriterionId: "argument-leap",
          claimedError: "Unsupported inference.",
          missingOrMisreadContext: "The sentence is conditional.",
          secondOpinionQuestion: "What supports the claim?",
          desiredDisposition: "modify_finding_interpretation",
        },
      }),
    );
    appeal = value(
      s.core.recordCorrectionAppeal({
        projectId: s.projectId,
        appealId: appeal.id,
        expectedVersion: appeal.version,
        actor: USER,
      }),
    );
    appeal = value(
      s.core.markCorrectionAppealRecordOnly({
        projectId: s.projectId,
        appealId: appeal.id,
        expectedVersion: appeal.version,
        actor: USER,
      }),
    );
    const result = value(
      s.core.resolveCorrectionAppeal({
        projectId: s.projectId,
        appealId: appeal.id,
        expectedVersion: appeal.version,
        actor: USER,
        kind: "modify_finding_interpretation",
        publicReason: "Synthetic interpretation correction.",
      }),
    );
    expect(result.source.findingSnapshot).toEqual(
      appeal.source.findingSnapshot,
    );
    expect({
      status: result.status,
      canonicalReviewId:
        (result as unknown as { canonicalReviewId?: string })
          .canonicalReviewId ?? null,
    }).toMatchObject({ canonicalReviewId: expect.any(String) });
  } finally {
    await s.cleanup();
  }
});
it("P2-02 G10/G12: production package declares a bundled Electron application entry", async () => {
  const pkg = JSON.parse(
    await readFile("apps/research-room/package.json", "utf8"),
  );
  // This is the real package contract consumed by the release builder. The
  // passing v0.2 artifact identity/lifecycle suite remains a separate gate.
  expect({
    main: pkg.main ?? null,
    electron:
      pkg.dependencies?.electron ?? pkg.devDependencies?.electron ?? null,
  }).toMatchObject({ main: expect.any(String), electron: expect.any(String) });
});
it("P2-02 G10/G12: the release tag verifier refuses a valid manifest from an unrelated source commit", async () => {
  const directory = await mkdtemp(
      join(tmpdir(), "sestina-g1-release-negative-"),
    ),
    root = `sestina-research-room-${identity.version}-windows-x64`;
  const paths = [
    `${root}/app/main.js`,
    `${root}/app/mcp/main.js`,
    `${root}/start.mjs`,
  ];
  const manifest = {
    schemaVersion: "3.0.0",
    identity,
    platform: {
      os: "win32",
      architecture: "x64",
      nativeSecretBackend: "windows-dpapi-current-user",
    },
    source: { gitCommit: "a4889ee996064d95ee0a3fb470ee6ee12d3a91a3" },
    distribution: {
      license: "Apache-2.0",
      repository: "https://github.com/Roblis0n/Sestina",
      tag: "v0.2.0",
      releaseUrl: "https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0",
      platformSlug: "windows-x64",
      primaryArtifact: `${root}.zip`,
    },
    compatibility: {
      nodeRange: identity.nodeRange,
      supportedSchemaMinimum: identity.supportedSchemaMinimum,
      supportedSchemaMaximum: identity.databaseSchemaVersion,
      futureSchemaPolicy: identity.futureSchemaPolicy,
      downgradeSupported: identity.downgradeSupported,
    },
    contents: {
      releaseBundleRoot: root,
      releaseBundlePaths: paths,
      executablePaths: paths,
    },
    security: {
      bindAddress: "127.0.0.1",
      localOnly: true,
      offlineCapable: true,
      telemetry: false,
      crashUpload: false,
      backgroundLogging: false,
      networkUpload: false,
      updateCheck: false,
      postinstall: false,
      containsSourceMaps: false,
      containsResearchData: false,
      containsCredentials: false,
      uninstallDeletesProjectData: false,
      npmPublished: false,
    },
    artifacts: [
      {
        file: `${root}.tar.gz`,
        kind: "platform-tar-gzip",
        sha256: "c".repeat(64),
        size: 1,
      },
      {
        file: `${root}.zip`,
        kind: "platform-zip",
        sha256: "d".repeat(64),
        size: 1,
      },
    ],
  };
  try {
    expect(() => validateReleaseManifest(manifest)).not.toThrow();
    await writeFile(
      join(directory, "release-manifest.json"),
      JSON.stringify(manifest),
    );
    const checked = spawnSync(
      process.execPath,
      [resolve("scripts/verify-release-tag.mjs"), "v0.2.0", directory],
      { windowsHide: true, encoding: "utf8" },
    );
    expect(checked.error).toBeUndefined();
    expect(checked.status).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
