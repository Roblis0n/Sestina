import { it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  DesktopUpdater,
  type UpdaterOptions,
} from "../../apps/desktop/src/updater.js";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sestina-updater-"));
  const keys = generateKeyPairSync("ed25519");
  const artifact = Buffer.from("Synthetic installer; never executed");
  const current = {
    version: "0.2.0-g10.aaaaaaaa",
    channel: "internal_candidate" as const,
    sequence: 1,
    platform: "win32",
    arch: "x64",
    schema: 25,
    sourceCommit: "a".repeat(40),
    migrationSourceSha256: "c".repeat(64),
  };
  const offer = {
    ...current,
    format: "2.0.0",
    version: "0.2.0-g10.bbbbbbbb",
    sourceCommit: "b".repeat(40),
    sequence: 2,
    sha256: hash(artifact),
    size: artifact.length,
    unsignedCoreSha256: "d".repeat(64),
    artifactPath: `/artifacts/${hash(artifact)}/Sestina.exe`,
    signed: false,
  };
  const envelope = (value: unknown) => {
    const payload = JSON.stringify(value);
    return {
      payload,
      keyId: "synthetic",
      signature: sign(null, Buffer.from(payload), keys.privateKey).toString(
        "base64",
      ),
    };
  };
  const calls: string[] = [];
  let installed = 0,
    backup = 0,
    preserved = 0;
  const options: UpdaterOptions = {
    directory,
    current,
    source: "https://updates.invalid/candidate.json",
    roots: {
      synthetic: keys.publicKey
        .export({ format: "pem", type: "spki" })
        .toString(),
    },
    fetch: async (url, request) => {
      calls.push(url);
      expect(request).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "error",
      });
      expect(JSON.stringify(request)).not.toContain(directory);
      return new Response(
        url.endsWith("candidate.json")
          ? JSON.stringify(envelope(offer))
          : artifact,
      );
    },
    beforeInstall: async () => {
      backup++;
      return {};
    },
    preserveProgram: async () => {
      preserved++;
      return current.sourceCommit;
    },
    launchInstaller: async () => {
      installed++;
    },
    restoreProgram: async () => {},
  };
  return {
    directory,
    artifact,
    current,
    offer,
    envelope,
    calls,
    options,
    counts: () => ({ installed, backup, preserved }),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
it("updates make no startup requests, verify signed candidate bytes, and back up before installation", async () => {
  const f = await fixture();
  try {
    const update = new DesktopUpdater(f.options);
    await update.initialize();
    expect(f.calls).toEqual([]);
    expect((await update.check()).stage).toBe("available");
    expect(f.calls).toHaveLength(1);
    expect((await update.download()).stage).toBe("verified");
    expect(f.counts().installed).toBe(0);
    expect((await update.install()).stage).toBe("installing");
    expect(f.counts()).toEqual({ backup: 1, preserved: 1, installed: 1 });
    const restarted = new DesktopUpdater(f.options);
    expect((await restarted.initialize()).stage).toBe("interrupted");
    expect(f.calls).toHaveLength(2);
    expect(f.counts().installed).toBe(1);
    const next = new DesktopUpdater({
      ...f.options,
      current: { ...f.current, ...f.offer },
    }); // restored journal remains explicit interruption after reconciliation
    expect((await next.initialize()).stage).toBe("interrupted");
    expect(f.calls).toHaveLength(2);
  } finally {
    await f.cleanup();
  }
});
it("tampered bytes, a failed backup, and stale on-disk installers cannot launch", async () => {
  const f = await fixture();
  try {
    const broken = new DesktopUpdater({
      ...f.options,
      fetch: async (url) =>
        new Response(
          url.endsWith("candidate.json")
            ? JSON.stringify(f.envelope(f.offer))
            : Buffer.alloc(f.artifact.length, 1),
        ),
    });
    await broken.check();
    expect((await broken.download()).stage).toBe("failed");
    expect(f.counts().installed).toBe(0);
    const update = new DesktopUpdater({
      ...f.options,
      beforeInstall: async () => {
        throw Error("Synthetic backup failure");
      },
    });
    await update.check();
    await update.download();
    expect((await update.install()).stage).toBe("failed");
    expect(f.counts().preserved).toBe(0);
    const tamper = new DesktopUpdater(f.options);
    await tamper.check();
    await tamper.download();
    await writeFile(
      join(f.directory, `${f.offer.sha256}.exe`),
      Buffer.alloc(f.artifact.length, 2),
    );
    expect((await tamper.install()).code).toBe("update_artifact_mismatch");
    expect(f.counts().installed).toBe(0);
  } finally {
    await f.cleanup();
  }
});
it("missing trust is unavailable; wrong channel, replay and migration identities are rejected", async () => {
  const f = await fixture();
  try {
    const unavailable = new DesktopUpdater({ ...f.options, roots: {} });
    expect((await unavailable.check()).stage).toBe("source_unavailable");
    expect(f.calls).toEqual([]);
    for (const change of [
      { version: "0.1.0-g10.bbbbbbbb" },
      { channel: "stable" },
      { sequence: 1 },
      { migrationSourceSha256: "e".repeat(64) },
      { arch: "arm64" },
      { sourceCommit: f.current.sourceCommit },
    ]) {
      const update = new DesktopUpdater({
        ...f.options,
        fetch: async () =>
          new Response(JSON.stringify(f.envelope({ ...f.offer, ...change }))),
      });
      expect((await update.check()).stage).toBe("failed");
      expect(f.counts().installed).toBe(0);
    }
  } finally {
    await f.cleanup();
  }
});
it("an explicit new check clears only recognized abandoned download files", async () => {
  const f = await fixture();
  try {
    const abandoned = `${f.offer.sha256}.exe.12345678-1234-4123-8123-123456789abc.part`;
    await writeFile(join(f.directory, abandoned), "partial synthetic bytes");
    await writeFile(
      join(f.directory, "user.part"),
      "unrecognized file retained",
    );
    const update = new DesktopUpdater(f.options);
    await update.initialize();
    expect(await readdir(f.directory)).toContain(abandoned);
    await update.check();
    expect(await readdir(f.directory)).not.toContain(abandoned);
    expect(await readdir(f.directory)).toContain("user.part");
  } finally {
    await f.cleanup();
  }
});
it("download cancellation removes its partial bytes and restart never resumes networking", async () => {
  const f = await fixture();
  try {
    let waiting: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const update = new DesktopUpdater({
      ...f.options,
      fetch: async (url, request) =>
        url.endsWith("candidate.json")
          ? new Response(JSON.stringify(f.envelope(f.offer)))
          : new Promise((_resolve, reject) => {
              waiting();
              request.signal?.addEventListener(
                "abort",
                () => reject(Error("aborted")),
                { once: true },
              );
            }),
    });
    await update.check();
    const pending = update.download();
    await started;
    update.cancel();
    expect((await pending).stage).toBe("cancelled");
    expect((await readdir(f.directory)).some((n) => n.endsWith(".part"))).toBe(
      false,
    );
    const restarted = new DesktopUpdater(f.options);
    expect((await restarted.initialize()).stage).toBe("cancelled");
    expect(f.calls).toEqual([]);
  } finally {
    await f.cleanup();
  }
});
