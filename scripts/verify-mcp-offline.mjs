#!/usr/bin/env node

import { spawn } from "node:child_process";

const [serverEntry, projectRoot, privateCanary] = process.argv.slice(2);
if (!serverEntry || !projectRoot || !privateCanary) throw new Error("mcp_offline_arguments_required");

const child = spawn(process.execPath, [serverEntry, "--project-root", projectRoot], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
if (!child.stdin || !child.stdout || !child.stderr) throw new Error("mcp_stdio_required");
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
let stdoutBuffer = ""; let stderr = ""; let nextId = 1;
const pending = new Map();
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  for (;;) {
    const newline = stdoutBuffer.indexOf("\n"); if (newline < 0) break;
    const line = stdoutBuffer.slice(0, newline).trim(); stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line); const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); waiter.resolve(message); }
  }
});
child.stderr.on("data", (chunk) => { stderr += chunk; });

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`mcp_timeout:${method}`)); }, 10_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function invariant(condition, message) { if (!condition) throw new Error(message); }

try {
  const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "ri41-offline-verifier", version: "1.0.0" } });
  invariant(initialized.result?.serverInfo?.name === "sestina-mcp", "mcp_initialize_failed");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  const tools = await request("tools/list");
  invariant(JSON.stringify(tools.result?.tools?.map((tool) => tool.name)) === JSON.stringify(["health", "get_research_context"]), "mcp_tool_surface_drift");
  const resources = await request("resources/list");
  invariant(JSON.stringify(resources.result?.resources?.map((resource) => resource.uri)) === JSON.stringify(["sestina://research/current-brief"]), "mcp_resource_surface_drift");
  const health = await request("tools/call", { name: "health", arguments: {} });
  invariant(health.result?.structuredContent?.mode === "read_only", "mcp_health_not_read_only");
  const context = await request("tools/call", { name: "get_research_context", arguments: {} });
  invariant(context.result?.structuredContent?.currentTask === privateCanary, "mcp_context_missing");
  invariant(context.result?.structuredContent?.contentBoundary?.authority === "none", "mcp_context_authority_drift");
  const resource = await request("resources/read", { uri: "sestina://research/current-brief" });
  invariant(resource.result?.contents?.length === 1, "mcp_resource_missing");
  child.stdin.end();
  const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  invariant(exitCode === 0, "mcp_exit_failed");
  invariant(stderr.includes('"event":"ready"'), "mcp_ready_missing");
  invariant(!stderr.includes(privateCanary), "mcp_private_text_leaked_to_stderr");
  invariant(!stderr.includes(projectRoot), "mcp_path_leaked_to_stderr");
  process.stdout.write(`${JSON.stringify({ mcp: true, tools: 2, resources: 1, mode: "read_only" })}\n`);
} finally {
  if (child.exitCode === null) child.kill();
}
