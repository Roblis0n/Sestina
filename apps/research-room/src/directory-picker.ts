import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { constants as priorityConstants, setPriority } from "node:os";
import { win32 } from "node:path";
import type { DirectoryPicker } from "./server.js";

const MAX_OUTPUT_BYTES = 32_768;
const WINDOWS_PICKER_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$shell = New-Object -ComObject Shell.Application
$folder = $null
try {
  # BIF_RETURNONLYFSDIRS | BIF_EDITBOX | BIF_VALIDATE | BIF_NEWDIALOGSTYLE.
  # Root at This PC to avoid eagerly walking Quick Access or arbitrary shell roots.
  $folder = $shell.BrowseForFolder(0, '选择 Sestina 研究项目文件夹', 0x71, 17)
  if ($null -ne $folder) {
    $selectedPath = $folder.Self.Path
    if (-not [String]::IsNullOrWhiteSpace($selectedPath)) {
      [Console]::Out.Write($selectedPath)
    }
  }
} finally {
  if ($null -ne $folder) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($folder) }
  if ($null -ne $shell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
}
`.trim();

export interface DirectoryPickerCommandRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly signal: AbortSignal;
}

export interface DirectoryPickerCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface DirectoryPickerCommandRunner {
  run(request: DirectoryPickerCommandRequest): Promise<DirectoryPickerCommandResult>;
}

const SYSTEM_RUNNER: DirectoryPickerCommandRunner = Object.freeze({
  run(request: DirectoryPickerCommandRequest): Promise<DirectoryPickerCommandResult> {
    return new Promise((resolve, reject) => {
      if (request.signal.aborted) { reject(new Error("The system folder picker was cancelled.")); return; }
      const child = spawn(request.executable, request.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      if (child.pid !== undefined) {
        try { setPriority(child.pid, priorityConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Best effort: never raise picker priority. */ }
      }
      const stdout: Buffer[] = []; let outputBytes = 0; let settled = false;
      const finish = (action: () => void) => { if (settled) return; settled = true; request.signal.removeEventListener("abort", abort); action(); };
      const abort = () => { child.kill(); finish(() => { reject(new Error("The system folder picker was cancelled.")); }); };
      request.signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) { child.kill(); finish(() => { reject(new Error("The system folder picker returned too much data.")); }); return; }
        stdout.push(chunk);
      });
      let stderrBytes = 0;
      child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stderrBytes > MAX_OUTPUT_BYTES) child.kill(); });
      child.once("error", () => { finish(() => { reject(new Error("The system folder picker could not be opened.")); }); });
      child.once("close", (code) => { finish(() => { resolve({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8") }); }); });
    });
  },
});

export interface NativeDirectoryPickerOptions {
  readonly platform?: NodeJS.Platform;
  readonly runner?: DirectoryPickerCommandRunner;
}

export function createNativeDirectoryPicker(options: NativeDirectoryPickerOptions = {}): DirectoryPicker | undefined {
  if ((options.platform ?? process.platform) !== "win32") return undefined;
  const runner = options.runner ?? SYSTEM_RUNNER;
  const encodedCommand = Buffer.from(WINDOWS_PICKER_COMMAND, "utf16le").toString("base64");
  return Object.freeze({
    async pick(signal: AbortSignal): Promise<string | undefined> {
      const result = await runner.run({
        executable: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-STA", "-EncodedCommand", encodedCommand],
        signal,
      });
      if (result.exitCode !== 0) throw new Error("The system folder picker could not be opened.");
      const selected = result.stdout.trim();
      if (selected.length === 0) return undefined;
      if (selected.includes("\n") || selected.includes("\r") || !win32.isAbsolute(selected)) throw new Error("The system folder picker returned an invalid directory.");
      return selected;
    },
  });
}
