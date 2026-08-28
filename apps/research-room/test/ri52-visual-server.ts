import { createResearchRoomServer } from "../src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../src/language-preferences.js";
import { createRi51Project } from "../../../tests/helpers/ri51-project.js";
import { Ri52FixtureHostRuntime } from "../../../tests/helpers/ri52-runtime.js";

class VisualLanguageStore implements LanguagePreferenceStore {
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve("zh-CN"); }
  writeLanguage(): Promise<void> { return Promise.resolve(); }
}

const fixture = await createRi51Project();
const runtime = new Ri52FixtureHostRuntime(fixture.acceptedDecisionId);
runtime.delayMs = 1_200;
const server = await createResearchRoomServer({
  closedExternalAppHostRuntime: runtime,
  directoryPicker: { pick: () => Promise.resolve(fixture.root) },
  languagePreferenceStore: new VisualLanguageStore(),
}).start();

process.stdout.write(`RI52_VISUAL_ORIGIN=${server.origin}\n`);
await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
await server.close();
await fixture.cleanup();
