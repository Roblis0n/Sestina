import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createResearchRoomServer,
  type RunningResearchRoomServer,
} from "../src/server.js";
import type {
  AppLanguage,
  LanguagePreferenceStore,
} from "../src/language-preferences.js";

class MemoryLanguagePreferenceStore implements LanguagePreferenceStore {
  constructor(private language: AppLanguage | undefined) {}
  readLanguage(): Promise<AppLanguage | undefined> {
    return Promise.resolve(this.language);
  }
  writeLanguage(language: AppLanguage): Promise<void> {
    this.language = language;
    return Promise.resolve();
  }
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

async function clientRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ui01-assets-"));
  roots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app-a1b2c3.js"></script></body></html>',
    "utf8",
  );
  await writeFile(join(root, "assets", "app-a1b2c3.js"), "export const shell = true;\n", "utf8");
  await writeFile(join(root, "assets", "app-a1b2c3.css"), ":root{color-scheme:light dark}\n", "utf8");
  return root;
}

describe("production Research Room client assets", () => {
  it("has one React production entry, keeps network access in the typed facade, and includes no remote UI assets", async () => {
    const appRoot = join(import.meta.dirname, "..");
    const clientRoot = join(appRoot, "client");
    const paths = (await readdir(clientRoot, { recursive: true })).filter((path) => /\.(?:css|html|ts|tsx)$/u.test(path));
    const sources = await Promise.all(paths.map(async (path) => ({ path, text: await readFile(join(clientRoot, path), "utf8") })));
    const componentFetches = sources.filter(({ path, text }) => path.includes("components") && /\bfetch\s*\(/u.test(text));
    expect(componentFetches).toEqual([]);
    expect(sources.filter(({ text }) => /(?:@import\s+url\s*\(|(?:src|href)=["']https?:|url\(["']?https?:)/iu.test(text))).toEqual([]);
    expect(sources.filter(({ path }) => /(?:^|[\\/])main\.tsx$/u.test(path))).toHaveLength(1);
    await expect(access(join(appRoot, "src", "ui.ts"))).rejects.toThrow();
  });

  it("serves the production HTML, hashed assets, MIME and security headers without a dev server", async () => {
    const root = await clientRoot();
    const running = await createResearchRoomServer({
      clientAssetRoot: root,
      languagePreferenceStore: new MemoryLanguagePreferenceStore("en"),
    }).start();
    servers.push(running);

    const page = await fetch(`${running.origin}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(await page.text()).toContain("/assets/app-a1b2c3.js");

    const script = await fetch(`${running.origin}/assets/app-a1b2c3.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(script.headers.get("cache-control")).toContain("immutable");

    const fallback = await fetch(`${running.origin}/review`);
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("diagnoses missing static resources and never returns the app HTML as a fake asset success", async () => {
    const root = await clientRoot();
    const running = await createResearchRoomServer({
      clientAssetRoot: root,
      languagePreferenceStore: new MemoryLanguagePreferenceStore("en"),
    }).start();
    servers.push(running);

    const missing = await fetch(`${running.origin}/assets/missing.js`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await missing.json()).toMatchObject({
      ok: false,
      error: { code: "client_asset_not_found" },
    });

    const legacy = await fetch(`${running.origin}/app.js`);
    expect(legacy.status).toBe(404);
    expect(await legacy.json()).toMatchObject({
      ok: false,
      error: { code: "client_asset_not_found" },
    });
  });
});
