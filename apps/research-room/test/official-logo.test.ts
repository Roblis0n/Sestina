import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_LOGO_SHA256 = "593661e38f3ef0ae664a4cf6e2eeedfba3e43d51b31a19c20e93b62e82570137";

describe("Sestina official logo", () => {
  it("keeps the user-selected 1024px raster as the one official logo asset", async () => {
    const appRoot = join(import.meta.dirname, "..");
    const publicRoot = join(appRoot, "client", "public");
    const logo = await readFile(join(publicRoot, "sestina-logo.png"));

    expect(logo.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(logo.readUInt32BE(16)).toBe(1024);
    expect(logo.readUInt32BE(20)).toBe(1024);
    expect(createHash("sha256").update(logo).digest("hex")).toBe(EXPECTED_LOGO_SHA256);

    const brandAssets = (await readdir(publicRoot))
      .filter((name) => /(?:sestina.*(?:logo|wordmark)|wordmark|horizontal)/iu.test(name))
      .sort();
    expect(brandAssets).toEqual(["sestina-logo.png"]);
  });

  it("uses that same mark in production chrome, boot and browser metadata without legacy letter marks", async () => {
    const appRoot = join(import.meta.dirname, "..");
    const [chrome, app, styles, html] = await Promise.all([
      readFile(join(appRoot, "client", "src", "components", "product", "AppChrome.tsx"), "utf8"),
      readFile(join(appRoot, "client", "src", "app", "App.tsx"), "utf8"),
      readFile(join(appRoot, "client", "src", "styles", "app.css"), "utf8"),
      readFile(join(appRoot, "client", "index.html"), "utf8"),
    ]);

    expect(chrome).toContain('src="/sestina-logo.png"');
    expect(app).toContain('src="/sestina-logo.png"');
    expect(html).toContain('rel="icon" type="image/png" href="/sestina-logo.png"');
    expect(chrome).not.toContain('className="brand__mark"');
    expect(app).not.toContain('className="boot-mark">S</div>');
    expect(styles).not.toContain(".brand__mark");
    expect(styles).not.toContain(".boot-mark");
  });

  it("defines the graphic mark itself—not a wordmark or lockup—as the sole logo authority", async () => {
    const repoRoot = join(import.meta.dirname, "..", "..", "..");
    const authority = await readFile(join(repoRoot, "docs", "product", "OFFICIAL-LOGO.md"), "utf8");

    expect(authority).toContain("唯一官方 Logo");
    expect(authority).toContain("产品名文字不是 Logo 的组成部分");
    expect(authority).toContain("593661E38F3EF0AE664A4CF6E2EEEDFBA3E43D51B31A19C20E93B62E82570137");
  });
});
