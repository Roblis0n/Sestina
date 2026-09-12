import { it, expect } from "vitest";
import {
  createProjectStateBackup,
  inspectProjectRecovery,
  previewProjectStateRestore,
  restoreProjectState,
  ProjectRecoveryConfirmationService,
  recoverInterruptedProjectStateRestore,
  openResearchDeliberationKernel,
} from "@sestina/core";
import {
  applicationFixture,
  session,
  ready,
  commit,
} from "../application-fixtures.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KernelApplicationApi } from "../../../apps/research-room/src/kernel-api.js";
it("G10: interrupted restore cleanup fences open and can finish without restoring older state", async () => {
  const f = await applicationFixture();
  try {
    f.kernel.close();
    const backup = await createProjectStateBackup({ projectRoot: f.root });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    const options = {
      projectRoot: f.root,
      backupId: backup.value.backupId,
      kernelRecovery: true,
    };
    const preview = await previewProjectStateRestore(options);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const result = await restoreProjectState({
      ...options,
      confirmed: true,
      expectedStateHash: preview.value.currentStateHash,
      expectedManifestHash: preview.value.manifestHash,
      faultInjection: {
        beforeRollbackCleanup: () => {
          throw Error("Synthetic cleanup interruption");
        },
      },
    });
    expect(result.ok).toBe(false);
    await expect(f.restart()).rejects.toThrow();
    expect(
      (
        await recoverInterruptedProjectStateRestore({
          projectRoot: f.root,
          confirmed: true,
        })
      ).ok,
    ).toBe(true);
    await f.restart();
  } finally {
    await f.cleanup();
  }
});
it("G10: an active desktop writer lease prevents a second writer until close", async () => {
  const f = await applicationFixture();
  let first: typeof f.kernel | undefined, second: typeof f.kernel | undefined;
  try {
    f.kernel.close();
    const options = { resolveUser: () => undefined, exclusiveLease: true };
    first = await openResearchDeliberationKernel(f.root, options);
    await expect(
      openResearchDeliberationKernel(f.root, options).then((k) => {
        second = k;
      }),
    ).rejects.toThrow();
    first.close();
    first = undefined;
    second = await openResearchDeliberationKernel(f.root, options);
  } finally {
    first?.close();
    second?.close();
    await f.cleanup();
  }
});

it("G10: restoring an older managed backup cannot resurrect forgotten Memory", async () => {
  const f = await applicationFixture();
  try {
    f.kernel.governMemory(
      "create-for-backup",
      1,
      {
        action: "create",
        kind: "working_hint",
        content: { text: "Synthetic context to forget" },
        retention: { policy: "until_unpinned" },
        sensitivity: "public",
        outboundPolicy: "explicit_manifest_only",
        publicReason: "Synthetic context",
      },
      session,
    );
    const item = f.kernel.memory(session).items[0]!.item;
    f.kernel.close();
    const backup = await createProjectStateBackup({ projectRoot: f.root });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    await f.restart();
    f.kernel.governMemory(
      "forget-after-backup",
      2,
      {
        action: "forget",
        itemId: item.id,
        expectedVersion: item.version,
        publicReason: "user_requested_irreversible_forget",
        confirmation: "FORGET",
      },
      session,
    );
    f.kernel.close();
    expect(
      (
        await previewProjectStateRestore({
          projectRoot: f.root,
          backupId: backup.value.backupId,
          kernelRecovery: true,
        })
      ).ok,
    ).toBe(false);
    await f.restart();
    expect(f.kernel.memory(session).items[0]!.item.state).toBe("forgotten");
  } finally {
    await f.cleanup();
  }
});

it("G10: the shared application exposes managed backup and restore through a closed session", async () => {
  const f = await applicationFixture();
  const api = new KernelApplicationApi({});
  try {
    f.kernel.close();
    const generation = api.status().sessionGeneration;
    const pending = api.maintenance({
      projectPath: f.root,
      sessionGeneration: generation,
      action: "backup_status",
    });
    await expect(
      api.repairBrief({ projectPath: f.root, confirmed: true }),
    ).rejects.toThrow();
    expect(api.status().sessionGeneration).toBe(generation);
    await pending;
    const input = {
      projectPath: f.root,
      sessionGeneration: api.status().sessionGeneration,
    };
    const backup = (await api.maintenance({ ...input, action: "backup" })) as {
      backupId: string;
    };
    expect(backup.backupId).toMatch(/^bkp_/);
  } finally {
    api.dispose();
    await f.cleanup();
  }
});

it("G10: an interrupted rollback leaves a durable record and blocks project reopening", async () => {
  const f = await applicationFixture();
  try {
    f.kernel.close();
    const backup = await createProjectStateBackup({ projectRoot: f.root });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    const input = {
      projectRoot: f.root,
      backupId: backup.value.backupId,
      kernelRecovery: true,
    };
    const preview = await previewProjectStateRestore(input);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const restored = await restoreProjectState({
      ...input,
      confirmed: true,
      expectedStateHash: preview.value.currentStateHash,
      expectedManifestHash: preview.value.manifestHash,
      faultInjection: {
        beforeBriefCommit: () => {
          throw Error("Synthetic interrupt");
        },
        beforeRollback: () => {
          throw Error("Synthetic recovery interrupt");
        },
      },
    });
    expect(restored.ok).toBe(false);
    expect(
      await readFile(
        join(f.root, ".sestina", ".managed-restore.json"),
        "utf8",
      ).catch(() => null),
    ).not.toBeNull();
    await expect(f.restart()).rejects.toThrow();
    expect(
      (
        await recoverInterruptedProjectStateRestore({
          projectRoot: f.root,
          confirmed: true,
        })
      ).ok,
    ).toBe(true);
    await f.restart();
  } finally {
    await f.cleanup();
  }
});

it("G10: schema25 recovery uses one-shot session-bound confirmation", async () => {
  const f = await applicationFixture();
  try {
    f.kernel.close();
    const backup = await createProjectStateBackup({ projectRoot: f.root });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    const service = new ProjectRecoveryConfirmationService();
    const input = {
      projectRoot: f.root,
      backupId: backup.value.backupId,
      sessionBinding: "synthetic-desktop-session",
      kernelRecovery: true,
    };
    const preview = await service.prepare(input);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const command = {
      ...input,
      confirmed: true,
      confirmationNonce: preview.value.confirmationNonce,
      expectedStateBinding: preview.value.stateBinding,
    };
    expect((await service.execute(command)).ok).toBe(true);
    expect((await service.execute(command)).ok).toBe(false);
  } finally {
    await f.cleanup();
  }
});

it("G10: a schema25 project can create and verify a managed backup without changing research revision", async () => {
  const f = await applicationFixture();
  try {
    const revision = f.kernel.brief(session).projectStateRevision;
    f.kernel.close();
    const backup = await createProjectStateBackup({ projectRoot: f.root });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    expect(backup.value).toMatchObject({
      databaseSchemaVersion: 25,
      networkUsed: false,
      integrity: "ok",
    });
    const status = await inspectProjectRecovery({ projectRoot: f.root });
    expect(status.ok && status.value.backups[0]?.valid).toBe(true);
    await f.restart();
    expect(f.kernel.brief(session).projectStateRevision).toBe(revision);
  } finally {
    await f.cleanup();
  }
});

it("G10: an old restore preview cannot replace a later saved draft", async () => {
  const f = await applicationFixture();
  try {
    f.kernel.close();
    const backup = await createProjectStateBackup({ projectRoot: f.root });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    const options = {
      projectRoot: f.root,
      backupId: backup.value.backupId,
      kernelRecovery: true,
    };
    const preview = await previewProjectStateRestore(options);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    await f.restart();
    const draft = f.kernel.createReview(
      "Later unsuperseded synthetic draft",
      session,
    );
    f.kernel.close();
    const restored = await restoreProjectState({
      ...options,
      confirmed: true,
      expectedManifestHash: preview.value.manifestHash,
      expectedStateHash: preview.value.currentStateHash,
    });
    expect(restored).toMatchObject({ ok: false });
    await f.restart();
    expect(f.kernel.readReview(draft.id, session).review.suggestion).toBe(
      draft.suggestion,
    );
  } finally {
    await f.cleanup();
  }
});

it("G10: a changed backup and a failed pair swap preserve the current project", async () => {
  const f = await applicationFixture();
  try {
    f.kernel.close();
    const backup = await createProjectStateBackup({ projectRoot: f.root });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    const options = {
      projectRoot: f.root,
      backupId: backup.value.backupId,
      kernelRecovery: true,
    };
    const preview = await previewProjectStateRestore(options);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const before = await readFile(join(f.root, ".sestina", "state.sqlite"));
    const failed = await restoreProjectState({
      ...options,
      confirmed: true,
      expectedManifestHash: preview.value.manifestHash,
      expectedStateHash: preview.value.currentStateHash,
      faultInjection: {
        beforeBriefCommit: () => {
          throw new Error("Synthetic swap interruption");
        },
      },
    });
    expect(failed.ok).toBe(false);
    expect(await readFile(join(f.root, ".sestina", "state.sqlite"))).toEqual(
      before,
    );
    const file = join(
      f.root,
      ".sestina",
      "backups",
      "manual",
      backup.value.backupId,
      "state.sqlite",
    );
    await writeFile(file, Buffer.from("Synthetic tamper"));
    expect((await previewProjectStateRestore(options)).ok).toBe(false);
    await f.restart();
  } finally {
    await f.cleanup();
  }
});

it("G10: restore revalidates a schema25 backup and current state, preserving newer work before replacing it", async () => {
  const f = await applicationFixture();
  try {
    const original = f.kernel.brief(session).projectStateRevision;
    f.kernel.close();
    const backup = await createProjectStateBackup({ projectRoot: f.root });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    await f.restart();
    commit(f, await ready(f), {
      kind: "record_only",
      outcome: "reference_only",
      reason: "Synthetic later decision",
    });
    f.kernel.close();
    const options = {
      projectRoot: f.root,
      backupId: backup.value.backupId,
      kernelRecovery: true,
    };
    const preview = await previewProjectStateRestore(options);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const restored = await restoreProjectState({
      ...options,
      confirmed: true,
      expectedManifestHash: preview.value.manifestHash,
      expectedStateHash: preview.value.currentStateHash,
    });
    expect(restored.ok).toBe(true);
    await f.restart();
    expect(f.kernel.brief(session).projectStateRevision).toBe(original);
  } finally {
    await f.cleanup();
  }
});
