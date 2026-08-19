import type { CliExitCode } from "./exit-codes.js";

export interface CliIo {
  readonly cwd: string;
  readonly isTTY: boolean;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export function success(io: CliIo, json: boolean, value: Readonly<Record<string, unknown>>, human: string): void {
  io.stdout(json ? `${JSON.stringify({ ok: true, ...value })}\n` : `${human}\n`);
}

export function failure(io: CliIo, json: boolean, code: CliExitCode, error: string, message: string): CliExitCode {
  io.stderr(json ? `${JSON.stringify({ ok: false, error: { code: error, message }, exitCode: code })}\n` : `Error: ${message}\n`);
  return code;
}
