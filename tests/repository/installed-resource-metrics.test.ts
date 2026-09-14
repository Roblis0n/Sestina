import { expect, it } from "vitest";
import { readInstalledProcessResources } from "../../scripts/lib/installed-resource-metrics.mjs";

const metrics = [{ pid: 42, memory: { workingSetSize: 128, peakWorkingSetSize: 256 } }];
it("native resource sampling uses bounded PID-only Windows, procfs and lsof inputs", () => {
  const calls: unknown[] = [];
  const linux = readInstalledProcessResources(metrics, { platform: "linux", readDirectory: (path: string) => { calls.push(path); return ["0", "1", "5"]; } });
  expect(calls).toEqual(["/proc/42/fd"]);
  expect(linux[0]).toMatchObject({ Id: 42, FileDescriptorCount: 3, WorkingSet64: 131072, PeakWorkingSet64: 262144 });
  const mac = readInstalledProcessResources(metrics, { platform: "darwin", run: (command: string, args: string[]) => { calls.push([command, args]); return "p42\nfcwd\nftxt\nf0\nf1\nf5\n"; } });
  expect(mac[0].FileDescriptorCount).toBe(3);
  expect(calls[1]).toEqual(["/usr/sbin/lsof", ["-nP", "-a", "-p", "42", "-Fpf"]]);
  const windows = readInstalledProcessResources(metrics, { platform: "win32", run: () => JSON.stringify({ Id: 42, HandleCount: 90, WorkingSet64: 1000, PeakWorkingSet64: 2000 }) });
  expect(windows[0]).toMatchObject({ Id: 42, HandleCount: 90, resourceKind: "windows_handles" });
});

it("missing, cross-process, unsupported or invalid resource observations cannot pass", () => {
  expect(() => readInstalledProcessResources([], { platform: "linux" })).toThrow();
  expect(() => readInstalledProcessResources([{ ...metrics[0], pid: "42; echo unsafe" }], { platform: "win32" })).toThrow();
  expect(() => readInstalledProcessResources(metrics, { platform: "darwin", run: () => "p43\nf0\n" })).toThrow();
  expect(() => readInstalledProcessResources(metrics, { platform: "linux", readDirectory: () => [] })).toThrow();
  expect(() => readInstalledProcessResources([{ pid: 42, memory: {} }], { platform: "linux", readDirectory: () => ["0"] })).toThrow();
  expect(() => readInstalledProcessResources(metrics, { platform: "win32", run: () => "[]" })).toThrow();
  expect(() => readInstalledProcessResources(metrics, { platform: "plan9" })).toThrow();
});
