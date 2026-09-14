import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

// Verification-only: sample only the PIDs returned by this Electron instance.
// Never enumerate other applications, resolve FD links or request file names.
export function readInstalledProcessResources(metrics, {
  platform = process.platform, run = execFileSync, readDirectory = readdirSync,
} = {}) {
  const ids = metrics.map((metric) => metric.pid);
  if (!ids.length || ids.some((pid) => !Number.isSafeInteger(pid) || pid < 1) || new Set(ids).size !== ids.length)
    throw Error("resource_process_identity_required");
  const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
  if (platform === "win32") {
    const raw = JSON.parse(String(run("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Get-Process -Id ${ids.join(",")} -ErrorAction Stop | Select-Object Id,HandleCount,WorkingSet64,PeakWorkingSet64 | ConvertTo-Json -Compress`,
    ], { windowsHide: true, encoding: "utf8" })));
    const rows = Array.isArray(raw) ? raw : [raw];
    if (rows.length !== ids.length || new Set(rows.map((row) => row.Id)).size !== ids.length || rows.some((row) =>
      !ids.includes(row.Id) || !integer(row.HandleCount, 1) || !integer(row.WorkingSet64, 1) ||
      !integer(row.PeakWorkingSet64, row.WorkingSet64)))
      throw Error("resource_observation_incomplete");
    return rows.map((row) => ({ ...row, resourceKind: "windows_handles", memorySource: "Get-Process" }));
  }
  if (!["linux", "darwin"].includes(platform)) throw Error("resource_platform_unsupported");
  return metrics.map(({ pid, memory }) => {
    let descriptors;
    if (platform === "linux") {
      const entries = readDirectory(`/proc/${pid}/fd`);
      if (!entries.length || entries.some((entry) => !/^\d+$/.test(entry)))
        throw Error("resource_observation_incomplete");
      descriptors = new Set(entries).size;
    } else {
      const lines = String(run("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-Fpf"], {
        encoding: "utf8", windowsHide: true,
      })).trim().split(/\r?\n/);
      if (lines.filter((line) => line.startsWith("p")).join() !== `p${pid}` ||
        lines.some((line) => !/^[pf]/.test(line)))
        throw Error("resource_process_identity_mismatch");
      descriptors = new Set(lines.filter((line) => /^f\d+$/.test(line))).size;
    }
    // Electron documents these OS-backed memory fields in KiB on all targets.
    // Missing values are failures, never zero or a fabricated lifetime peak.
    const working = memory?.workingSetSize * 1024;
    const peak = memory?.peakWorkingSetSize * 1024;
    if (!integer(descriptors, 1) || !integer(working, 1) || !integer(peak, working))
      throw Error("resource_observation_incomplete");
    return { Id: pid, FileDescriptorCount: descriptors, WorkingSet64: working,
      PeakWorkingSet64: peak, resourceKind: "posix_file_descriptors",
      descriptorSource: platform === "linux" ? "procfs_fd_entries" : "lsof_pid_fd_fields",
      memorySource: "Electron OS process metrics (KiB converted to bytes)" };
  });
}
