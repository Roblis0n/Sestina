import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppLanguage, LanguagePreferenceStore } from "../src/language-preferences.js";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../src/server.js";

class MemoryLanguagePreferenceStore implements LanguagePreferenceStore {
  constructor(private language: AppLanguage | undefined) {}
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve(this.language); }
  writeLanguage(language: AppLanguage): Promise<void> { this.language = language; return Promise.resolve(); }
}

const servers: RunningResearchRoomServer[] = [];
const roots: string[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});
async function post(origin: string, token: string, path: string, body: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sestina-session": token },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

describe("explicit native-folder initialization preview", () => {
  it("does not write until the user confirms the selected plain directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ui01-preview-"));
    roots.push(root);
    const running = await createResearchRoomServer({
      directoryPicker: { pick: () => Promise.resolve(root) },
      languagePreferenceStore: new MemoryLanguagePreferenceStore("en"),
    }).start();
    servers.push(running);
    const status = await (await fetch(`${running.origin}/api/status`)).json() as { value: { sessionToken: string } };

    const preview = await post(running.origin, status.value.sessionToken, "/api/project/select-directory/preview", {});
    expect(preview.response.status).toBe(200);
    expect(preview.body).toMatchObject({ ok: true, value: { selected: true, initializationRequired: true, pathPersisted: false, directoryScanPerformed: false } });
    expect(JSON.stringify(preview.body)).not.toContain(root);
    expect(await readdir(root)).toEqual([]);

    const value = (preview.body.value ?? {}) as { confirmationNonce?: string };
    const initialized = await post(running.origin, status.value.sessionToken, "/api/project/initialize-selected", { confirmationNonce: value.confirmationNonce });
    expect(initialized.response.status).toBe(200);
    expect(initialized.body).toMatchObject({ ok: true, value: { initialized: true, setupRequired: true } });
    expect(await readdir(root)).toEqual([".sestina"]);
  });

  it("fails closed on an invalid confirmation and exposes setup recovery in status", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ui01-preview-invalid-"));
    roots.push(root);
    const running = await createResearchRoomServer({
      directoryPicker: { pick: () => Promise.resolve(root) },
      languagePreferenceStore: new MemoryLanguagePreferenceStore("zh-CN"),
    }).start();
    servers.push(running);
    const firstStatus = await (await fetch(`${running.origin}/api/status`)).json() as { value: { sessionToken: string } };
    await post(running.origin, firstStatus.value.sessionToken, "/api/project/select-directory/preview", {});

    const rejected = await post(running.origin, firstStatus.value.sessionToken, "/api/project/initialize-selected", { confirmationNonce: "wrong" });
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toMatchObject({ ok: false, error: { code: "initialization_confirmation_invalid" } });
    expect(await readdir(root)).toEqual([]);
  });
});
