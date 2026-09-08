/** Transport contract. HTTP and the future preload adapter carry these values only. */
export type KernelWireValue =
  | null
  | boolean
  | number
  | string
  | readonly KernelWireValue[]
  | { readonly [key: string]: KernelWireValue };
export interface KernelSessionProjection {
  readonly projectId: string | null;
  readonly sessionGeneration: number;
  readonly automaticSend: boolean;
  readonly readOnly?: boolean;
}
export const KERNEL_COMMANDS = [
  "workspace",
  "rebuild_views",
  "legacy_detail",
  "legacy_history",
  "convert_legacy",
  "enable_host_bridge",
  "revoke_host_bridge",
  "import_envelope",
  "memory",
  "privacy_status",
  "privacy_copy_preview",
  "privacy_cleanup",
  "recall_memory",
  "govern_memory",
  "brief",
  "publish_brief",
  "memory_source",
  "relationships",
  "artifact_context",
  "coverage",
  "brief_conflict",
  "correction_history",
  "create",
  "read",
  "manifest",
  "list",
  "lookup",
  "edit",
  "prepare_manifest",
  "confirm_manifest",
  "skip_assessment",
  "prepare_attempt",
  "start_attempt",
  "cancel_attempt",
  "cancel",
  "prepare_effect",
  "commit",
  "prepare_compensation",
  "append_correction",
] as const;
export type KernelCommandName = (typeof KERNEL_COMMANDS)[number];
export type KernelCommandRequest = {
  readonly projectId: string;
  readonly sessionGeneration: number;
  readonly action: KernelCommandName;
} & Readonly<Record<string, KernelWireValue>>;
export interface KernelApplicationPort {
  status(): KernelSessionProjection;
  open(input: {
    readonly projectPath: string;
    readonly readOnly?: boolean;
  }): Promise<KernelSessionProjection & { readonly schema: number }>;
  close(): void;
  execute(
    input: KernelCommandRequest,
    requireSession?: boolean,
  ): Promise<unknown>;
}
export interface KernelTransport {
  invoke(request: KernelCommandRequest, signal?: AbortSignal): Promise<unknown>;
}
export function decodeKernelSession(value: unknown): KernelSessionProjection {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_payload");
  const v = value as Record<string, unknown>;
  if (
    (v.projectId !== null &&
      (typeof v.projectId !== "string" ||
        !/^rprj_[0-9A-HJKMNP-TV-Z]{26}$/.test(v.projectId))) ||
    !Number.isSafeInteger(v.sessionGeneration) ||
    Number(v.sessionGeneration) < 0 ||
    v.automaticSend !== false
  )
    throw new Error("invalid_payload");
  if (v.readOnly !== undefined && typeof v.readOnly !== "boolean")
    throw new Error("invalid_payload");
  return {
    readOnly: v.readOnly === true,
    projectId: v.projectId,
    sessionGeneration: v.sessionGeneration as number,
    automaticSend: false,
  };
}
