import { kernelHash, KernelFault } from "@sestina/core";
import type { KernelApplicationApi } from "./kernel-api.js";

export interface TrustedConfirmation {
  readonly action: string;
  readonly projectId: string;
  readonly snapshot: unknown;
  readonly bindingHash: string;
}
const sensitive = new Set([
  "commit",
  "start_attempt",
  "govern_memory",
  "privacy_cleanup",
  "enable_host_bridge",
]);

/** Main-owned user interaction. No serialized token or renderer claim grants authority. */
export class TrustedKernelCommands {
  #generation = 0;
  #pending = false;
  constructor(
    readonly api: KernelApplicationApi,
    private readonly confirm: (detail: TrustedConfirmation) => Promise<boolean>,
    private readonly now = Date.now,
  ) {}
  revoke() {
    this.#generation++;
  }
  async execute(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new KernelFault("invalid_record");
    const body = structuredClone(input) as Record<string, unknown>;
    if (typeof body.action !== "string")
      throw new KernelFault("invalid_record");
    // Reject authority-shaped additions before opening a dialog.
    if (
      ["actorId", "authority", "capability", "nonce"].some((key) =>
        Object.hasOwn(body, key),
      )
    )
      throw new KernelFault("authority_required");
    if (this.#pending) throw new Error("confirmation_in_progress");
    if (!sensitive.has(body.action)) return this.api.execute(body, true);
    const generation = this.#generation,
      session = this.api.status();
    if (
      session.projectId !== body.projectId ||
      session.sessionGeneration !== body.sessionGeneration
    )
      throw new Error("session_changed");
    const snapshot = async () => {
      const base = {
        projectId: body.projectId,
        sessionGeneration: body.sessionGeneration,
      };
      if (body.action === "commit" || body.action === "start_attempt") {
        const read = await this.api.execute(
          { ...base, action: "read", reviewId: body.reviewId },
          true,
        );
        const manifest = await this.api.execute(
          { ...base, action: "manifest", reviewId: body.reviewId },
          true,
        );
        return { read, manifest };
      }
      if (body.action === "privacy_cleanup")
        return {
          copyAction: body.copyAction ?? "delete",
          plan: await this.api.execute(
            { ...base, action: "privacy_copy_preview" },
            true,
          ),
        };
      if (body.action === "govern_memory")
        return {
          memory: await this.api.execute({ ...base, action: "memory" }, true),
          input: body.input,
        };
      return {
        capability: "draft_and_status_only",
        expiresInMinutes: 10,
        restart: "disabled",
      };
    };
    this.#pending = true;
    try {
      const saved = await snapshot();
      const bindingHash = kernelHash({ session, body, saved });
      const expiresAt = this.now() + 60000;
      const accepted = await this.confirm(
        Object.freeze({
          action: body.action,
          projectId: String(body.projectId),
          snapshot: structuredClone(saved),
          bindingHash,
        }),
      );
      if (!accepted) throw new Error("confirmation_declined");
      if (
        generation !== this.#generation ||
        this.now() >= expiresAt ||
        kernelHash(this.api.status()) !== kernelHash(session)
      )
        throw new Error("confirmation_expired");
      if (
        kernelHash({ session, body, saved: await snapshot() }) !== bindingHash
      )
        throw new Error("confirmation_stale");
      // The grant is consumed here, in this invocation, and never returned to IPC.
      // Release the native-confirmation lock when its one-use grant is consumed.
      // Provider I/O may remain pending; reads, cancellation and a new explicit
      // user decision must remain available while the Kernel owns that attempt.
      return this.api.execute(
        {
          ...body,
          ...(["commit", "start_attempt", "privacy_cleanup"].includes(
            body.action,
          )
            ? { confirmed: true }
            : {}),
        },
        true,
      );
    } finally {
      this.#pending = false;
    }
  }
}
