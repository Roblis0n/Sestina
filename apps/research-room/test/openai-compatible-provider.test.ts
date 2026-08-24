import { createHash } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareResearchRoomSemanticJudge,
  type ResearchRoomSemanticJudgeRequest,
} from "@sestina/core";
import {
  OpenAICompatibleProviderError,
  createOpenAICompatibleProvider,
} from "../src/openai-compatible-provider.js";
import type { OpenAICompatibleProviderConfig, ProviderRuntimeSnapshot } from "../src/provider-settings.js";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let idCounter = 8_100;

function testId(prefix: "rprj_" | "rrvw_" | "rbrf_" | "rart_" | "rrev_"): string {
  idCounter += 1;
  let remaining = idCounter;
  let encoded = "";
  while (remaining > 0) {
    encoded = CROCKFORD_ALPHABET.charAt(remaining % 32) + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return prefix + encoded.padStart(26, "0");
}
const servers: Server[] = [];

function request(provider: ResearchRoomSemanticJudgeRequest["provider"]): ResearchRoomSemanticJudgeRequest {
  const projectId = testId("rprj_");
  const result = prepareResearchRoomSemanticJudge({
    reviewId: testId("rrvw_"),
    projectId,
    provider,
    stateBindingHash: "a".repeat(64),
    brief: {
      id: testId("rbrf_"), versionNumber: 1,
      projectQuestion: "How should this bounded association be reported?",
      currentStage: "revision", currentTask: "Add one evidence-bounded sentence.",
      fixedDecisions: [], expectedDeltas: [], evidenceBoundaries: ["Do not claim causality."], explicitNonGoals: ["Do not change the research object."],
    },
    decisions: [], issues: [], receiptSummary: [],
    suggestionDocument: { projectId, artifactId: testId("rart_"), revisionId: testId("rrev_"), text: "Retain the observational boundary." },
    evidenceClass: "synthetic_fixture",
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

async function localServer(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function snapshot(baseUrl: string, overrides: Partial<OpenAICompatibleProviderConfig> = {}): ProviderRuntimeSnapshot {
  return {
    config: {
      schemaVersion: "1.0.0", family: "openai_compatible", providerId: "local-judge",
      baseUrl, model: "judge-model", timeoutMs: 1_000, locality: "local", generation: 4,
      ...overrides,
    },
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => { resolve(); }))));
});

describe("one-shot OpenAI-compatible Semantic Judge adapter", () => {
  it("previews and sends one exact, hash-bound request without putting the API key in visible data", async () => {
    const received: { headers?: Record<string, string | string[] | undefined>; body?: string; count: number } = { count: 0 };
    const { origin } = await localServer((incoming, response) => {
      received.count += 1;
      received.headers = incoming.headers;
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => {
        received.body = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{\"ok\":true}" }, finish_reason: "stop" }] }));
      });
    });
    const runtime = { ...snapshot(`${origin}/v1`), apiKey: "never-display-this-key" };
    const provider = createOpenAICompatibleProvider(runtime, { readCurrentGeneration: () => Promise.resolve(4) });
    expect(provider.networkAccess).toBe("loopback");
    const judgeRequest = request(provider.binding);
    const preview = provider.prepare(judgeRequest);

    expect(preview.endpoint).toBe(`${origin}/v1/chat/completions`);
    expect(preview.requestHash).toBe(judgeRequest.requestHash);
    expect(preview.requestBodyBytes).toBeGreaterThan(0);
    expect(preview.requestBodyHash).toBe(createHash("sha256").update(preview.requestBody, "utf8").digest("hex"));
    expect(JSON.stringify(preview)).not.toContain("never-display-this-key");
    const content = await provider.analyze(judgeRequest, preview, { signal: new AbortController().signal });

    expect(content).toBe("{\"ok\":true}");
    expect(received.count).toBe(1);
    expect(received.headers?.authorization).toBe("Bearer never-display-this-key");
    expect(received.body).toBe(preview.requestBody);
    expect(JSON.parse(received.body ?? "{}")).toMatchObject({ model: "judge-model", temperature: 0, stream: false, response_format: { type: "json_object" } });
  });

  it("blocks a changed configuration generation before opening the network", async () => {
    let calls = 0;
    const { origin } = await localServer((_request, response) => { calls += 1; response.end(); });
    const provider = createOpenAICompatibleProvider(snapshot(origin), { readCurrentGeneration: () => Promise.resolve(5) });
    const judgeRequest = request(provider.binding);
    await expect(provider.analyze(judgeRequest, provider.prepare(judgeRequest), { signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "provider_configuration_changed" });
    expect(calls).toBe(0);
  });

  it("does not follow redirects or retry", async () => {
    let calls = 0;
    const { origin } = await localServer((_request, response) => {
      calls += 1;
      response.writeHead(302, { location: `${origin}/other` });
      response.end();
    });
    const provider = createOpenAICompatibleProvider(snapshot(origin), { readCurrentGeneration: () => Promise.resolve(4) });
    const judgeRequest = request(provider.binding);
    await expect(provider.analyze(judgeRequest, provider.prepare(judgeRequest), { signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(OpenAICompatibleProviderError);
    expect(calls).toBe(1);
  });

  it("aborts on the configured timeout and never retries", async () => {
    let calls = 0;
    const { origin } = await localServer((_request, response) => {
      calls += 1;
      setTimeout(() => { if (!response.destroyed) response.end("late"); }, 500);
    });
    const provider = createOpenAICompatibleProvider(snapshot(origin, { timeoutMs: 100 }), { readCurrentGeneration: () => Promise.resolve(4) });
    const judgeRequest = request(provider.binding);
    await expect(provider.analyze(judgeRequest, provider.prepare(judgeRequest), { signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "provider_timeout" });
    expect(calls).toBe(1);
  });

  it("rejects an oversized response while keeping its body out of the error", async () => {
    const privateBody = "private-provider-output-".repeat(8_000);
    const { origin } = await localServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(privateBody);
    });
    const provider = createOpenAICompatibleProvider(snapshot(origin), { readCurrentGeneration: () => Promise.resolve(4) });
    const judgeRequest = request(provider.binding);
    try {
      await provider.analyze(judgeRequest, provider.prepare(judgeRequest), { signal: new AbortController().signal });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "provider_response_too_large" });
      expect(String(error)).not.toContain("private-provider-output");
    }
  });

  it.each([
    ["non-JSON envelope", "text/plain", "provider-secret-body", "provider_invalid_response"],
    ["non-success status", "application/json", "provider-secret-body", "provider_http_error"],
  ])("sanitizes %s failures", async (_name, contentType, body, code) => {
    const { origin } = await localServer((_request, response) => {
      response.writeHead(code === "provider_http_error" ? 401 : 200, { "content-type": contentType });
      response.end(body);
    });
    const provider = createOpenAICompatibleProvider(snapshot(origin), { readCurrentGeneration: () => Promise.resolve(4) });
    const judgeRequest = request(provider.binding);
    try {
      await provider.analyze(judgeRequest, provider.prepare(judgeRequest), { signal: new AbortController().signal });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain(body);
      expect(String(error)).not.toContain(origin);
    }
  });
});
