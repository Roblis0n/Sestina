import { createResearchRoomServer } from "./server.js";

function requestedPort(argv: readonly string[]): number {
  const index = argv.indexOf("--port");
  if (index === -1) return 43_148;
  const value = Number(argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) throw new Error("--port must be an integer from 1 to 65535.");
  return value;
}

try {
  const instance = createResearchRoomServer({ host: "127.0.0.1", port: requestedPort(process.argv.slice(2)) });
  const running = await instance.start();
  process.stdout.write(`Sestina Research Room: ${running.origin}\n`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await running.close(); process.exitCode = 0; };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
} catch (error) {
  process.stderr.write(`Research Room failed to start: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}
