import { syntheticProject, USER } from "./factory.js";
import {
  migrateKernelProject,
  openResearchDeliberationKernel,
  type KernelProvider,
  type KernelApplicationOptions,
} from "@sestina/core";
export const session = Object.freeze({ localSession: "synthetic" });
export const resolveUser = (value: unknown) =>
  value === session ? USER : undefined;
export class ApplicationProvider implements KernelProvider {
  readonly identity = {
    id: "synthetic",
    model: "fixture",
    family: "openai_compatible",
    locality: "local" as const,
    origin: "http://127.0.0.1:1",
    configGeneration: 1,
    serializerVersion: "1.0.0",
  };
  readonly maxOutputTokens = 1024;
  readonly calls: string[] = [];
  constructor(
    readonly mode:
      "valid" | "failure" | "invalid" | "timeout" | "unbound" = "valid",
  ) {}
  send(body: string, _signal: AbortSignal): Promise<string> {
    this.calls.push(body);
    if (this.mode === "failure")
      return Promise.reject(
        new Error("Synthetic disconnect after possible send."),
      );
    if (this.mode === "timeout") return new Promise(() => {});
    if (this.mode === "invalid") return Promise.resolve("invalid JSON");
    const request = JSON.parse(body),
      context = JSON.parse(request.messages[1].content);
    return Promise.resolve(
      JSON.stringify({
        schemaVersion: "2.0.0",
        requestBinding:
          this.mode === "unbound"
            ? {
                ...context.requestBinding,
                projectStateRevision:
                  context.requestBinding.projectStateRevision + 1,
              }
            : context.requestBinding,
        publicSummary:
          "The moon is green; this unsupported opinion proves nothing.",
        quotedSpans: [],
      }),
    );
  }
}
export async function applicationFixture(
  provider?: KernelProvider,
  extra: Partial<KernelApplicationOptions> = {},
) {
  const synthetic = await syntheticProject();
  synthetic.core.close();
  await migrateKernelProject({ projectRoot: synthetic.root });
  let currentProvider = provider;
  const options = {
    resolveUser,
    provider: async () => currentProvider,
    timeoutMs: 30,
    ...extra,
  };
  let kernel = await openResearchDeliberationKernel(synthetic.root, options);
  return {
    ...synthetic,
    get kernel() {
      return kernel;
    },
    options,
    setProvider(p: KernelProvider | undefined) {
      currentProvider = p;
    },
    async restart() {
      kernel.close();
      kernel = await openResearchDeliberationKernel(synthetic.root, options);
      return kernel;
    },
    async cleanup() {
      kernel.close();
      await synthetic.cleanup();
    },
  };
}
export async function ready(
  f: Awaited<ReturnType<typeof applicationFixture>>,
  suggestion = "Synthetic bounded change",
) {
  const r = f.kernel.createReview(suggestion, session);
  return f.kernel.skipAssessment(r.id, r.version, session);
}
export function commit(
  f: Awaited<ReturnType<typeof applicationFixture>>,
  r: { id: string; version: number },
  payload: unknown,
) {
  const prepared = f.kernel.prepareEffect(r.id, r.version, payload, session),
    d = prepared.effectDraft!;
  return f.kernel.commitEffect(
    r.id,
    prepared.version,
    d.previewHash,
    d.authorityCommandId!,
    session,
  );
}
