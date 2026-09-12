import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  verifyUpdateOffer,
  type InstalledUpdateIdentity,
  type UpdateOffer,
  type UpdateEnvelope,
} from "./update-policy.js";

export type UpdateStage =
  | "not_checked"
  | "source_unavailable"
  | "checking"
  | "available"
  | "downloading"
  | "verified"
  | "preparing_install"
  | "installing"
  | "installed"
  | "cancelled"
  | "failed"
  | "interrupted";
export interface UpdateProjection {
  stage: UpdateStage;
  currentVersion: string;
  version?: string;
  received: number;
  size?: number;
  code?: string;
  backupId?: string;
  rollbackAvailable: boolean;
  schema?: number;
  channel?: string;
}
interface UpdateRecord {
  format: "1.0.0";
  stage: UpdateStage;
  envelope?: UpdateEnvelope;
  backupId?: string;
  projectPath?: string;
  rollbackId?: string;
  code?: string;
}
export interface UpdaterOptions {
  directory: string;
  current: InstalledUpdateIdentity;
  roots: Readonly<Record<string, string>>;
  source?: string;
  fetch?: (url: string, options: RequestInit) => Promise<Response>;
  beforeInstall: () => Promise<{ backupId?: string; projectPath?: string }>;
  preserveProgram: () => Promise<string>;
  launchInstaller: (path: string, offer: UpdateOffer) => Promise<void>;
  restoreProgram: (rollbackId: string) => Promise<void>;
}
/** Explicit actions only. Construction, status and restart reconciliation never fetch. */
export class DesktopUpdater {
  #record: UpdateRecord = { format: "1.0.0", stage: "not_checked" };
  #offer: UpdateOffer | undefined;
  #received = 0;
  #busy = false;
  #abort: AbortController | undefined;
  #interrupted = false;
  constructor(private readonly options: UpdaterOptions) {}
  get busy() {
    return this.#busy;
  }
  status(): UpdateProjection {
    return {
      stage: this.#record.stage,
      currentVersion: this.options.current.version,
      received: this.#received,
      rollbackAvailable: Boolean(this.#record.rollbackId),
      ...(this.#offer
        ? {
            version: this.#offer.version,
            size: this.#offer.size,
            schema: this.#offer.schema,
            channel: this.#offer.channel,
          }
        : {}),
      ...(this.#record.code ? { code: this.#record.code } : {}),
      ...(this.#record.backupId ? { backupId: this.#record.backupId } : {}),
    };
  }
  async #root() {
    const path = resolve(this.options.directory);
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(path)) !== path
    )
      throw Error("update_path_changed");
    return path;
  }
  async #save(stage: UpdateStage, extra: Partial<UpdateRecord> = {}) {
    const root = await this.#root();
    const next = { ...this.#record, ...extra, stage };
    const temporary = join(root, `.record-${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(next) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    const destination = join(root, "update.json");
    const existing = await lstat(destination).catch(() => undefined);
    if (existing && (!existing.isFile() || existing.isSymbolicLink()))
      throw Error("update_path_changed");
    await rename(temporary, destination);
    this.#record = next;
  }
  async initialize() {
    const path = join(await this.#root(), "update.json");
    const info = await lstat(path).catch(() => undefined);
    if (!info) return this.status();
    try {
      if (!info.isFile() || info.isSymbolicLink() || info.size > 32768)
        throw Error("update_record_invalid");
      const saved: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!saved || typeof saved !== "object" || Array.isArray(saved))
        throw Error("update_record_invalid");
      const record = saved as Omit<UpdateRecord, "format"> & {
        format: unknown;
      };
      if (
        record.format !== "1.0.0" ||
        Object.keys(record).some(
          (k) =>
            ![
              "format",
              "stage",
              "envelope",
              "backupId",
              "projectPath",
              "rollbackId",
              "code",
            ].includes(k),
        ) ||
        typeof record.stage !== "string" ||
        ![
          "not_checked",
          "source_unavailable",
          "checking",
          "available",
          "downloading",
          "verified",
          "preparing_install",
          "installing",
          "installed",
          "cancelled",
          "failed",
          "interrupted",
        ].includes(record.stage) ||
        (record.projectPath !== undefined &&
          (typeof record.projectPath !== "string" ||
            record.projectPath.length > 4096)) ||
        (record.rollbackId !== undefined &&
          !/^[a-f0-9]{40}$/.test(record.rollbackId)) ||
        (record.backupId !== undefined &&
          !/^upg_\d{8}T\d{9}Z_[a-f0-9]{12}$/.test(record.backupId))
      )
        throw Error("update_record_invalid");
      this.#record = { ...record, format: "1.0.0" };
      if (record.envelope) {
        // A completed install has the offered identity. Signature and full target
        // contract are still checked using a comparison-only earlier identity.
        const comparison = {
          ...this.options.current,
          sequence: -1,
          sourceCommit: "0".repeat(40),
          version: "0.0.0",
        };
        const offered = verifyUpdateOffer(
          record.envelope,
          this.options.roots,
          comparison,
        );
        this.#offer = offered;
        if (
          record.stage === "installing" &&
          offered.sourceCommit === this.options.current.sourceCommit &&
          offered.version === this.options.current.version
        ) {
          await this.#save("installed");
          return this.status();
        }
      }
      if (
        [
          "checking",
          "downloading",
          "preparing_install",
          "installing",
          "verified",
          "available",
        ].includes(record.stage)
      )
        await this.#save("interrupted", { code: "update_interrupted" });
    } catch {
      this.#record = {
        format: "1.0.0",
        stage: "failed",
        code: "update_record_invalid",
      };
    }
    return this.status();
  }
  #endpoint() {
    if (!this.options.source || Object.keys(this.options.roots).length === 0)
      return undefined;
    const url = new URL(this.options.source);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw Error("update_source_invalid");
    return url;
  }
  async #request(
    url: string,
    limit: number,
    consume: (bytes: Uint8Array) => Promise<void>,
  ) {
    const response = await (this.options.fetch ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/octet-stream" },
      signal: this.#abort?.signal,
    });
    if (!response.ok || !response.body) throw Error("update_network_failed");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
      throw Error("update_size_invalid");
    const reader =
      response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let total = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > limit) throw Error("update_size_invalid");
        if (this.#abort?.signal.aborted) throw Error("update_cancelled");
        await consume(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (length !== null && total !== Number(length))
      throw Error("update_truncated");
    return total;
  }
  async #job(action: () => Promise<void>) {
    if (this.#busy) throw Error("update_in_progress");
    this.#busy = true;
    this.#interrupted = false;
    this.#abort = new AbortController();
    try {
      await action();
    } catch (error) {
      const code = this.interrupted()
        ? "update_interrupted"
        : this.#abort.signal.aborted
          ? "update_cancelled"
          : error instanceof Error && /^update_[a-z_]+$/.test(error.message)
            ? error.message
            : "update_operation_failed";
      await this.#save(
        code === "update_interrupted"
          ? "interrupted"
          : code === "update_cancelled"
            ? "cancelled"
            : "failed",
        { code },
      );
    } finally {
      this.#busy = false;
      this.#abort = undefined;
    }
    return this.status();
  }
  check() {
    return this.#job(async () => {
      const root = await this.#root();
      for (const name of await readdir(root)) {
        if (
          !/^[a-f0-9]{64}\.(?:exe|dmg|AppImage)\.[a-f0-9-]{36}\.part$/.test(
            name,
          )
        )
          continue;
        const path = join(root, name),
          info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink())
          throw Error("update_path_changed");
        await this.#root();
        await rm(path);
      }
      const source = this.#endpoint();
      if (!source) {
        await this.#save("source_unavailable");
        return;
      }
      await this.#save("checking", { code: undefined });
      this.#received = 0;
      const chunks: Uint8Array[] = [];
      await this.#request(source.href, 32768, (b) => {
        chunks.push(b);
        return Promise.resolve();
      });
      const envelope: unknown = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      );
      this.#offer = verifyUpdateOffer(
        envelope,
        this.options.roots,
        this.options.current,
      );
      await this.#save("available", {
        envelope: envelope as UpdateEnvelope,
        code: undefined,
      });
    });
  }
  async #artifact() {
    if (!this.#offer) throw Error("update_not_verified");
    return join(
      await this.#root(),
      `${this.#offer.sha256}.${this.options.current.platform === "win32" ? "exe" : this.options.current.platform === "darwin" ? "dmg" : "AppImage"}`,
    );
  }
  async #verifyFile(path: string) {
    const offer = this.#offer;
    if (!offer || !this.#record.envelope) throw Error("update_not_verified");
    verifyUpdateOffer(
      this.#record.envelope,
      this.options.roots,
      this.options.current,
    );
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== offer.size)
      throw Error("update_artifact_mismatch");
    const handle = await open(path, "r");
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        const bytes: unknown = chunk;
        if (!Buffer.isBuffer(bytes)) throw Error("update_artifact_mismatch");
        size += bytes.length;
        hash.update(bytes);
      }
    } finally {
      await handle.close();
    }
    if (size !== offer.size || hash.digest("hex") !== offer.sha256)
      throw Error("update_artifact_mismatch");
  }
  download() {
    return this.#job(async () => {
      if (this.#record.stage !== "available" || !this.#offer)
        throw Error("update_not_available");
      const source = this.#endpoint();
      if (!source) throw Error("update_source_invalid");
      const root = await this.#root();
      const free = await statfs(root);
      if (free.bavail * free.bsize < this.#offer.size + 67108864)
        throw Error("update_space_insufficient");
      const destination = await this.#artifact();
      const partial = `${destination}.${randomUUID()}.part`;
      await this.#save("downloading");
      this.#received = 0;
      const file = await open(partial, "wx", 0o600);
      const hash = createHash("sha256");
      try {
        const total = await this.#request(
          new URL(this.#offer.artifactPath, source.origin).href,
          this.#offer.size,
          async (bytes) => {
            await this.#root();
            await file.writeFile(bytes);
            hash.update(bytes);
            this.#received += bytes.byteLength;
          },
        );
        if (
          total !== this.#offer.size ||
          hash.digest("hex") !== this.#offer.sha256
        )
          throw Error("update_artifact_mismatch");
        if (this.#abort?.signal.aborted) throw Error("update_cancelled");
        await file.sync();
      } catch (error) {
        await file.close();
        await rm(partial, { force: true });
        throw error;
      }
      await file.close();
      await this.#root();
      if (this.#abort?.signal.aborted) {
        await rm(partial, { force: true });
        throw Error("update_cancelled");
      }
      if (await lstat(destination).catch(() => undefined)) {
        await this.#verifyFile(destination);
        await rm(partial);
      } else await rename(partial, destination);
      await this.#verifyFile(destination);
      await this.#save("verified");
    });
  }
  cancel() {
    if (
      this.#record.stage !== "checking" &&
      this.#record.stage !== "downloading"
    )
      throw Error("update_cancel_unavailable");
    this.#abort?.abort();
    return this.status();
  }
  interrupt() {
    this.#interrupted = true;
    this.#abort?.abort();
  }
  private interrupted() {
    return this.#interrupted;
  }
  install() {
    return this.#job(async () => {
      if (this.#record.stage !== "verified" || !this.#offer)
        throw Error("update_not_verified");
      const artifact = await this.#artifact();
      await this.#verifyFile(artifact);
      await this.#save("preparing_install");
      const backup = await this.options.beforeInstall();
      await this.#save("preparing_install", backup);
      if (this.#abort?.signal.aborted) throw Error("update_interrupted");
      const rollbackId = await this.options.preserveProgram();
      if (!/^[a-f0-9]{40}$/.test(rollbackId))
        throw Error("update_rollback_invalid");
      if (this.#abort?.signal.aborted) throw Error("update_interrupted");
      await this.#verifyFile(artifact);
      await this.#save("installing", { ...backup, rollbackId });
      await this.options.launchInstaller(artifact, this.#offer);
    });
  }
  recoverProgram() {
    return this.#job(async () => {
      if (!this.#record.rollbackId) throw Error("update_rollback_unavailable");
      await this.options.restoreProgram(this.#record.rollbackId);
    });
  }
}
