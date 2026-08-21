import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PILOT_CONSENT_VERSION,
  canonicalStringify,
  checkpointPilotSession,
  deletePilotSession,
  exportPilotSession,
  finishPilotSession,
  parseShareablePilotExport,
  showPilotSession,
  sha256,
  startPilotSession,
} from "../src/index.js";

const BUILD_ID =
  "86469e5ccc3c3b593084c6207545a4d8bfd1d23f19016d1d63973b49052c3085";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `sestina-pilot-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function startInput(privateRoot: string, participantCode = "EXT-0001") {
  return {
    privateRoot,
    participantCode,
    sessionId: `ps_${(participantCode === "EXT-0001" ? "1" : "2").repeat(32)}`,
    evidenceId: `pe_${(participantCode === "EXT-0001" ? "1" : "2").repeat(24)}`,
    sessionOrdinal: 1 as const,
    participantRole: "external_researcher" as const,
    hostEntry: "cli" as const,
    materialType: "paper" as const,
    consentVersion: PILOT_CONSENT_VERSION,
    consentAcknowledged: true,
    releaseVersion: "0.1.0",
    releaseBuildId: BUILD_ID,
    at: "2026-08-21T01:00:00.000Z",
  };
}

async function completeSession(privateRoot: string, participantCode = "EXT-0001") {
  const session = await startPilotSession(startInput(privateRoot, participantCode));
  const checkpoints = [
    ["install_started", "2026-08-21T01:01:00.000Z"],
    ["install_succeeded", "2026-08-21T01:03:00.000Z"],
    ["initialization_succeeded", "2026-08-21T01:08:00.000Z"],
    ["brief_completed", "2026-08-21T01:12:00.000Z"],
    ["episode_started", "2026-08-21T01:14:00.000Z"],
    ["episode_completed", "2026-08-21T01:45:00.000Z"],
    ["review_completed", "2026-08-21T01:48:00.000Z"],
  ] as const;
  for (const [event, at] of checkpoints) {
    await checkpointPilotSession({
      privateRoot,
      sessionId: session.sessionId,
      event,
      at,
      exitPoint: null,
    });
  }
  return finishPilotSession({
    privateRoot,
    sessionId: session.sessionId,
    at: "2026-08-21T01:55:00.000Z",
    exitResult: "completed",
    repeatCorrectionImpact: "reduced",
    findingAssessment: { necessary: 3, unnecessary: 1, uncertain: 0 },
    maintenanceBurden: { brief: 2, decision: 3, issue: 2 },
    preferredEntry: "cli",
    uiNeed: "no",
    syntheticCaseDiscussion: "undecided",
    wouldUseAgain: "yes",
    failureObserved: false,
    negativeFeedbackObserved: false,
  });
}

describe("private Pilot session lifecycle", () => {
  it("refuses to create a session without current explicit consent", async () => {
    const parent = await tempRoot("consent");
    const privateRoot = join(parent, "pilot-private");
    await expect(
      startPilotSession({ ...startInput(privateRoot), consentAcknowledged: false }),
    ).rejects.toThrowError("pilot_consent_required");
    expect(existsSync(privateRoot)).toBe(false);
  });

  it("derives bounded outcomes from checkpoints and exports only shareable fields", async () => {
    const parent = await tempRoot("lifecycle");
    const privateRoot = join(parent, "pilot-private");
    const exportPath = join(parent, "shared", "export.json");
    const finished = await completeSession(privateRoot);
    expect(finished.finish?.setup).toEqual({
      outcome: "success",
      durationMinutes: 7,
    });
    expect(finished.finish?.episode).toEqual({
      outcome: "completed",
      durationMinutes: 31,
    });

    const exported = await exportPilotSession({
      privateRoot,
      sessionId: finished.sessionId,
      exportPath,
    });
    expect(parseShareablePilotExport(exported)).toEqual(exported);
    const bytes = await readFile(exportPath, "utf8");
    for (const forbidden of [privateRoot, "startedAt", "checkpoints", "finish"])
      expect(bytes).not.toContain(forbidden);
  });

  it("rejects private-session schema injection without echoing the injected value", async () => {
    const parent = await tempRoot("schema");
    const privateRoot = join(parent, "pilot-private");
    const session = await startPilotSession(startInput(privateRoot));
    const sessionFile = join(privateRoot, `${session.sessionId}.json`);
    const value = JSON.parse(readFileSync(sessionFile, "utf8")) as Record<
      string,
      unknown
    >;
    value.paperText = "SYNTHETIC_PRIVATE_PAPER_CANARY";
    writeFileSync(sessionFile, JSON.stringify(value), "utf8");
    await expect(
      showPilotSession({ privateRoot, sessionId: session.sessionId }),
    ).rejects.toThrowError(/^pilot_session_invalid$/u);
  });

  it("rejects a contradictory checkpoint chain even with a matching integrity hash", async () => {
    const parent = await tempRoot("contradiction");
    const privateRoot = join(parent, "pilot-private");
    const session = await startPilotSession(startInput(privateRoot));
    const sessionFile = join(privateRoot, `${session.sessionId}.json`);
    const value = JSON.parse(readFileSync(sessionFile, "utf8")) as Record<
      string,
      unknown
    >;
    value.checkpoints = [
      {
        event: "install_succeeded",
        occurredAt: "2026-08-21T01:01:00.000Z",
        exitPoint: null,
      },
    ];
    const unsigned = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "integrityHash"),
    );
    value.integrityHash = sha256(canonicalStringify(unsigned));
    writeFileSync(sessionFile, JSON.stringify(value), "utf8");
    await expect(
      showPilotSession({ privateRoot, sessionId: session.sessionId }),
    ).rejects.toThrowError(/^pilot_session_invalid$/u);
  });

  it("deletes only the explicitly selected session", async () => {
    const parent = await tempRoot("delete");
    const privateRoot = join(parent, "pilot-private");
    const first = await startPilotSession(startInput(privateRoot, "EXT-0001"));
    const second = await startPilotSession(startInput(privateRoot, "EXT-0002"));
    await deletePilotSession({ privateRoot, sessionId: first.sessionId });
    expect(existsSync(join(privateRoot, `${first.sessionId}.json`))).toBe(false);
    expect(existsSync(join(privateRoot, `${second.sessionId}.json`))).toBe(true);
    expect(readdirSync(privateRoot).filter((name) => name.endsWith(".json"))).toEqual([
      `${second.sessionId}.json`,
    ]);
  });

  it("rejects a duplicate participant ordinal and lexical traversal", async () => {
    const parent = await tempRoot("ordinal");
    const privateRoot = join(parent, "pilot-private");
    await startPilotSession(startInput(privateRoot));
    await expect(
      startPilotSession({
        ...startInput(privateRoot),
        sessionId: `ps_${"9".repeat(32)}`,
        evidenceId: `pe_${"9".repeat(24)}`,
      }),
    ).rejects.toThrowError("pilot_session_ordinal_conflict");

    const traversalRoot = `${parent}${sep}safe${sep}..${sep}escaped-private`;
    await expect(startPilotSession(startInput(traversalRoot))).rejects.toThrowError(
      "pilot_private_root_unsafe",
    );
    expect(existsSync(join(parent, "escaped-private"))).toBe(false);
  });

  it("rejects a symlink or junction private root", async () => {
    const parent = await tempRoot("symlink");
    const target = join(parent, "target");
    const linked = join(parent, "linked-private");
    mkdirSync(target);
    symlinkSync(target, linked, process.platform === "win32" ? "junction" : "dir");
    await expect(startPilotSession(startInput(linked))).rejects.toThrowError(
      "pilot_private_root_unsafe",
    );
  });

  it("rejects checkpoints that contradict the observed workflow", async () => {
    const parent = await tempRoot("workflow");
    const privateRoot = join(parent, "pilot-private");
    const session = await startPilotSession(startInput(privateRoot));

    await expect(
      checkpointPilotSession({
        privateRoot,
        sessionId: session.sessionId,
        event: "install_succeeded",
        exitPoint: null,
        at: "2026-08-21T01:01:00.000Z",
      }),
    ).rejects.toThrowError("pilot_checkpoint_invalid");
    await expect(
      checkpointPilotSession({
        privateRoot,
        sessionId: session.sessionId,
        event: "episode_completed",
        exitPoint: null,
        at: "2026-08-21T01:02:00.000Z",
      }),
    ).rejects.toThrowError("pilot_checkpoint_invalid");

    await checkpointPilotSession({
      privateRoot,
      sessionId: session.sessionId,
      event: "install_started",
      exitPoint: null,
      at: "2026-08-21T01:03:00.000Z",
    });
    await checkpointPilotSession({
      privateRoot,
      sessionId: session.sessionId,
      event: "install_succeeded",
      exitPoint: null,
      at: "2026-08-21T01:04:00.000Z",
    });
    await expect(
      checkpointPilotSession({
        privateRoot,
        sessionId: session.sessionId,
        event: "install_failed",
        exitPoint: null,
        at: "2026-08-21T01:05:00.000Z",
      }),
    ).rejects.toThrowError("pilot_checkpoint_invalid");
  });

  it("requires exit evidence only on the matching exit checkpoint", async () => {
    const parent = await tempRoot("exit-point");
    const privateRoot = join(parent, "pilot-private");
    const session = await startPilotSession(startInput(privateRoot));

    await expect(
      checkpointPilotSession({
        privateRoot,
        sessionId: session.sessionId,
        event: "install_started",
        exitPoint: "installation",
        at: "2026-08-21T01:01:00.000Z",
      }),
    ).rejects.toThrowError("pilot_checkpoint_invalid");
    await expect(
      checkpointPilotSession({
        privateRoot,
        sessionId: session.sessionId,
        event: "connect_exited",
        exitPoint: null,
        at: "2026-08-21T01:02:00.000Z",
      }),
    ).rejects.toThrowError("pilot_checkpoint_invalid");
    await expect(
      checkpointPilotSession({
        privateRoot,
        sessionId: session.sessionId,
        event: "connect_exited",
        exitPoint: "episode",
        at: "2026-08-21T01:03:00.000Z",
      }),
    ).rejects.toThrowError("pilot_checkpoint_invalid");

    const exited = await checkpointPilotSession({
      privateRoot,
      sessionId: session.sessionId,
      event: "participant_exited",
      exitPoint: "other",
      at: "2026-08-21T01:04:00.000Z",
    });
    expect(exited.checkpoints.at(-1)?.exitPoint).toBe("other");

    const finished = await finishPilotSession({
      privateRoot,
      sessionId: session.sessionId,
      at: "2026-08-21T01:05:00.000Z",
      exitResult: "exited",
      repeatCorrectionImpact: "uncertain",
      findingAssessment: { necessary: 0, unnecessary: 0, uncertain: 0 },
      maintenanceBurden: { brief: 3, decision: 3, issue: 3 },
      preferredEntry: "none",
      uiNeed: "uncertain",
      syntheticCaseDiscussion: "undecided",
      wouldUseAgain: "uncertain",
      failureObserved: false,
      negativeFeedbackObserved: true,
    });
    const exported = await exportPilotSession({
      privateRoot,
      sessionId: finished.sessionId,
      exportPath: join(parent, "exited-shareable.json"),
    });
    expect(exported).toMatchObject({ exitResult: "exited", exitPoint: "other" });
  });
});
