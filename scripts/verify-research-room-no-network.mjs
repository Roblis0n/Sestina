#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = mkdtempSync(join(tmpdir(), "sestina-ri48-no-network-"));
const marker = join(runtime, "guard-active.txt");
const attempts = join(runtime, "network-attempts.txt");
const preload = join(root, "scripts", "no-network-preload.mjs");
const child = join(root, "scripts", "verify-research-room-no-network-child.mjs");
try {
  if (!existsSync(join(root, "apps/research-room/dist/server.js"))) throw new Error("Build the Research Room before no-network verification.");
  const result = spawnSync(process.execPath, [child], { cwd: root, encoding: "utf8", timeout: 60_000, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`.trim(), SESTINA_NO_NETWORK_GUARD_MARKER: marker, SESTINA_NO_NETWORK_ATTEMPT_MARKER: attempts } });
  if (result.status !== 0) throw new Error(`guarded Research Room workflow failed (${result.status ?? "no status"}): ${result.stderr.trim()}`);
  if (!existsSync(marker) || readFileSync(marker, "utf8").trim().length === 0) throw new Error("network guard was not active");
  if (existsSync(attempts) && readFileSync(attempts, "utf8").trim().length > 0) throw new Error("default Research Room attempted outbound network access");
  const value = JSON.parse(result.stdout.trim());
  if (value.researchRoomOfflineVerified !== true || value.browserInitializationVerified !== true || value.nativePickerFlowVerified !== true || value.initialBriefActivationVerified !== true || value.loopbackPolicy !== true || value.providerConfigured !== false || value.networkAttempts !== 0 || value.backgroundArtifacts !== 0) throw new Error("offline result contract drifted");
  process.stdout.write(`${JSON.stringify(value)}\n`);
} catch (error) {
  process.stderr.write(`Research Room no-network verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
} finally {
  rmSync(runtime, { recursive: true, force: true });
}
