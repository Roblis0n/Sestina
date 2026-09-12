import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  symlink,
  rm,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopPreferenceStore } from "../../apps/desktop/src/preferences.js";
import { LegacySettingsMigration } from "../../apps/desktop/src/legacy-settings.js";
import type { SecretBackend } from "@sestina/secrets";
it("an interrupted language migration does not overwrite preferences changed after interruption", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-language-"));
  const secrets: SecretBackend = {
    health: async () => ({ available: false, backend: "none" }),
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    describe: async () => ({ configured: false }),
  };
  try {
    const source = join(root, "old"),
      target = join(root, "new");
    await mkdir(source);
    await mkdir(target);
    await writeFile(
      join(source, "preferences.json"),
      JSON.stringify({ schemaVersion: "1.0.0", language: "en" }),
    );
    class Interrupted extends DesktopPreferenceStore {
      override async update(
        patch: Parameters<DesktopPreferenceStore["update"]>[0],
      ) {
        await super.update(patch);
        throw Error("Synthetic post-write interruption");
      }
    }
    await expect(
      new LegacySettingsMigration(
        target,
        secrets,
        new Interrupted(target),
        source,
        () => secrets,
      ).run(),
    ).rejects.toThrow();
    const store = new DesktopPreferenceStore(target);
    const current = await store.read();
    await store.update({
      language: "zh-CN",
      appearance: { ...current.appearance, theme: "dark" },
    });
    await new LegacySettingsMigration(
      target,
      secrets,
      store,
      source,
      () => secrets,
    ).run();
    expect((await store.read()).language).toBe("zh-CN");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("preferences refuse a replaced application directory without writing through it", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-preferences-"));
  try {
    const outside = join(root, "unrelated"),
      linked = join(root, "settings");
    await mkdir(outside);
    await symlink(
      outside,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      new DesktopPreferenceStore(linked).update({ language: "en" }),
    ).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
