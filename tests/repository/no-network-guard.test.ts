import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const preload = resolve(root, "scripts", "no-network-preload.mjs");
const temporary = mkdtempSync(join(tmpdir(), "sestina-network-guard-test-"));
const marker = join(temporary, "active.txt");
const guarded = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`.trim(),
  SESTINA_NO_NETWORK_GUARD_MARKER: marker,
};

afterAll(() => { rmSync(temporary, { recursive: true, force: true }); });

describe("RI-41 active no-network preload", () => {
  for (const [surface, source] of [
    ["net.connect", 'require("node:net").connect(443, "example.com")'],
    ["net.createConnection", 'require("node:net").createConnection(443, "example.com")'],
    ["http.request", 'require("node:http").request("http://example.com").end()'],
    ["https.request", 'require("node:https").request("https://example.com").end()'],
    ["tls.connect", 'require("node:tls").connect(443, "example.com")'],
    ["dns.lookup", 'require("node:dns").lookup("example.com", () => {})'],
    ["dns.promises.resolve", 'require("node:dns").promises.resolve("example.com")'],
    ["fetch", 'fetch("https://example.com")'],
    ["WebSocket", 'new WebSocket("wss://example.com")'],
    ["dgram.createSocket", 'require("node:dgram").createSocket("udp4")'],
  ] as const) {
    it(`blocks ${surface} before an outbound attempt`, () => {
      const result = spawnSync(process.execPath, ["-e", source], { encoding: "utf8", env: guarded });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`SESTINA_NETWORK_BLOCKED:${surface}`);
      expect(result.stderr).not.toContain("ENOTFOUND");
    });
  }

  it("writes an activation marker for guarded child processes", () => {
    const result = spawnSync(process.execPath, ["-e", "process.stdout.write('guarded')"], { encoding: "utf8", env: guarded });
    expect(result).toMatchObject({ status: 0, stdout: "guarded", stderr: "" });
    expect(readFileSync(marker, "utf8").trim().split(/\r?\n/u).length).toBeGreaterThanOrEqual(1);
  });
});
