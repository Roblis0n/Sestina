import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResearchRoomServer } from "../src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../src/language-preferences.js";
import { createRi50FixtureProject, createRi50ParticipantPair } from "./ri50-test-fixture.js";

class VisualLanguageStore implements LanguagePreferenceStore {
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve("zh-CN"); }
  writeLanguage(): Promise<void> { return Promise.resolve(); }
}

const root = await mkdtemp(join(tmpdir(), "sestina-ri50-visual-"));
await createRi50FixtureProject(root);
const pair = createRi50ParticipantPair({ delayA: 900, delayB: 900 });
const server = await createResearchRoomServer({
  deliberationParticipantProviders: pair.providers,
  directoryPicker: { pick: () => Promise.resolve(root) },
  languagePreferenceStore: new VisualLanguageStore(),
}).start();

process.stdout.write(`RI50_VISUAL_ORIGIN=${server.origin}\n`);
await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
await server.close();
await rm(root, { recursive: true, force: true });
