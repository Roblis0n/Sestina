import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const children: ChildProcessWithoutNullStreams[] = [];
const projectRoots: string[] = [];

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop();
    if (!child) continue;
    if (child.exitCode !== null) continue;
    child.kill();
    await Promise.race([
      once(child, "exit"),
      new Promise<void>((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
  }
  while (projectRoots.length > 0) {
    const root = projectRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("No TCP address was assigned.");
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
  return address.port;
}

async function waitForOrigin(child: ChildProcessWithoutNullStreams): Promise<string> {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });

  return await new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(new Error(`Production entry did not start. stderr: ${stderr}`));
    }, 10_000);
    const finish = (callback: () => void): void => {
      clearTimeout(timeout);
      child.stdout.removeAllListeners("data");
      child.removeAllListeners("exit");
      callback();
    };
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const origin = /Sestina Research Room: (http:\/\/127\.0\.0\.1:\d+)/u.exec(stdout)?.[1];
      if (origin) finish(() => { resolveOrigin(origin); });
    });
    child.once("exit", (code) => {
      finish(() => {
        rejectOrigin(new Error(`Production entry exited with ${String(code)}. stderr: ${stderr}`));
      });
    });
  });
}

describe("Research Room production entry", () => {
  it("boots the built App Shell without a development server or undeclared workspace package", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    await execFileAsync(process.execPath, [join(repositoryRoot, "scripts", "build-research-room.mjs")], {
      cwd: repositoryRoot,
      timeout: 30_000,
      windowsHide: true,
    });

    const port = await availablePort();
    const child = spawn(process.execPath, [
      join(repositoryRoot, "apps", "research-room", "dist", "main.js"),
      "--port",
      String(port),
    ], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    children.push(child);

    const origin = await waitForOrigin(child);
    expect(origin).toBe(`http://127.0.0.1:${String(port)}`);
    const status = await fetch(`${origin}/api/status`);
    expect(status.status).toBe(200);
    const statusBody = await status.json() as {
      readonly value: { readonly languagePreference: "zh-CN" | "en" | null; readonly sessionToken: string };
    };
    expect(statusBody).toMatchObject({
      ok: true,
      value: { localOnly: true, telemetry: false },
    });

    const mutationHeaders = {
      "content-type": "application/json",
      "x-sestina-session": statusBody.value.sessionToken,
    };
    if (statusBody.value.languagePreference === null) {
      const language = await fetch(`${origin}/api/preferences/language`, {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ language: "en" }),
      });
      expect(language.status).toBe(200);
    }

    const projectRoot = await mkdtemp(join(tmpdir(), "sestina-production-entry-"));
    projectRoots.push(projectRoot);
    const opened = await fetch(`${origin}/api/project/open`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ projectPath: projectRoot, initializeIfNeeded: true }),
    });
    expect(opened.status).toBe(200);
    await expect(opened.json()).resolves.toMatchObject({
      ok: true,
      value: { initialized: true, setupRequired: true, localOnly: true },
    });

    const activated = await fetch(`${origin}/api/project/brief`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ projectQuestion: "Can the production App persist local research state?", currentTask: "Verify production state access." }),
    });
    expect(activated.status).toBe(200);
    await expect(activated.json()).resolves.toMatchObject({
      ok: true,
      value: { brief: { currentTask: "Verify production state access." } },
    });

    const restored = await fetch(`${origin}/api/state`);
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      ok: true,
      value: { brief: { projectQuestion: "Can the production App persist local research state?" } },
    });
  }, 30_000);
});
