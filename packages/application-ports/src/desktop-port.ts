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
  "preferences",
  "settingsMigration",
  "integration",
  "pickDirectory",
  "open",
  "createProject",
  "closeProject",
  "kernelStatus",
  "maintenance",
  "repairBrief",
  "showBackupDirectory",
  "providerStatus",
  "providerSave",
  "providerDeleteConfig",
  "providerDeleteSecret",
  "about",
  "checkUpdate",
  "update",
  "closeWindow",
] as const;
export type DesktopMethod = (typeof DESKTOP_METHODS)[number];
export interface DesktopUpdateProjection {
  stage:
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
export interface ManagedBackupProjection {
  readonly backupId: string;
  readonly kind: "manual" | "pre_restore" | "pre_upgrade";
  readonly valid: boolean;
  readonly createdAt?: string;
  readonly databaseSchemaVersion?: number;
}
export interface ManagedRecoveryProjection {
  readonly currentState: "healthy" | "recovery_required";
  readonly interruptedRestore?: boolean;
  readonly backups: readonly ManagedBackupProjection[];
  readonly networkUsed: false;
}
export interface ManagedRestoreProjection {
  readonly backupId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly databaseSchemaVersion: number;
  readonly databaseSizeBytes: number;
  readonly confirmationNonce: string;
  readonly stateBinding: string;
  readonly expiresAt: string;
}
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
  onSessionClosed(listener: () => void): () => void;
}
