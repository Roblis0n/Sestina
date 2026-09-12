import type { KernelCommandName, KernelCommandRequest } from "./index.js";
export interface DesktopReply {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: {
    readonly code: string;
    readonly reasons: readonly string[];
  };
}
export const DESKTOP_METHODS = [
  "status",
  "language",
  "pickDirectory",
  "open",
  "createProject",
  "closeProject",
  "kernelStatus",
  "maintenance",
  "repairBrief",
  "providerStatus",
  "providerSave",
  "providerDeleteConfig",
  "providerDeleteSecret",
  "about",
  "checkUpdate",
  "closeWindow",
] as const;
export type DesktopMethod = (typeof DESKTOP_METHODS)[number];
export interface DesktopBridge {
  readonly methods: Readonly<
    Record<DesktopMethod, (input?: unknown) => Promise<DesktopReply>>
  >;
  readonly commands: Readonly<
    Record<
      KernelCommandName,
      (input: KernelCommandRequest) => Promise<DesktopReply>
    >
  >;
  onCloseRequested(listener: () => void): () => void;
}
