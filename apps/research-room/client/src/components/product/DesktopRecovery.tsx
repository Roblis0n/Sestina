import { useState } from "react";
import type {
  ManagedRecoveryProjection,
  ManagedRestoreProjection,
} from "@sestina/application-ports";
import { desktop } from "../../api/desktop.js";
import { Button } from "../primitives/Button.js";

export function DesktopRecovery({
  en,
  path,
  busy,
  run,
  onReopen,
}: {
  en: boolean;
  path: string;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onReopen: () => void;
}) {
  const [status, setStatus] = useState<ManagedRecoveryProjection>();
  const [preview, setPreview] = useState<ManagedRestoreProjection>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  async function invoke(action: string, extra: Record<string, unknown> = {}) {
    const bridge = desktop();
    if (!bridge) throw Error("desktop_unavailable");
    const session = await bridge.methods.kernelStatus();
    if (!session.ok) throw Error("session_changed");
    const generation = (session.value as { sessionGeneration: number })
      .sessionGeneration;
    const reply = await bridge.methods.maintenance({
      projectPath: path,
      action,
      sessionGeneration: generation,
      ...extra,
    });
    if (!reply.ok) throw Error(reply.error?.code ?? "operation_failed");
    return reply.value;
  }
  async function refresh() {
    setStatus((await invoke("backup_status")) as ManagedRecoveryProjection);
  }
  function act(operation: () => Promise<void>) {
    void run(async () => {
      setMessage("");
      setError("");
      try {
        await operation();
      } catch (failure) {
        const code =
          failure instanceof Error ? failure.message : "operation_failed";
        setError(
          code === "confirmation_declined"
            ? en
              ? "Restore cancelled. Your project is kept."
              : "已取消恢复，项目保持原状。"
            : [
                  "confirmation_binding_mismatch",
                  "confirmation_expired",
                  "stale_revision",
                  "confirmation_replayed",
                ].includes(code)
              ? en
                ? "This preview is no longer valid. Check the backup again before restoring."
                : "此预览已失效，请重新核对备份后再恢复。"
              : en
                ? "The operation could not finish. Check the recovery status before reopening; your backup files are kept."
                : "操作未能完成。请检查恢复状态后再打开项目，备份文件仍保留。",
        );
        setPreview(undefined);
      }
    });
  }
  return (
    <details className="desktop-recovery">
      <summary>{en ? "Backups and recovery" : "备份与恢复"}</summary>
      <p>
        {en
          ? "Back up saved work in this folder. Restoring replaces the current saved project and first creates a verified copy of it. No network connection is used."
          : "在此文件夹备份已保存的工作。恢复会替换当前已保存的项目，执行前会先创建并验证当前状态的副本。此过程不联网。"}
      </p>
      <div className="action-row">
        <Button
          disabled={busy || !path}
          onClick={() => {
            act(async () => {
              setPreview(undefined);
              await invoke("backup");
              await refresh();
              setMessage(
                en ? "Backup created and verified." : "备份已创建并验证。",
              );
            });
          }}
        >
          {en ? "Create backup" : "创建备份"}
        </Button>
        <Button
          disabled={busy || !path}
          onClick={() => {
            act(refresh);
          }}
        >
          {en ? "Check saved backups" : "检查已有备份"}
        </Button>
        <Button
          disabled={busy || !status?.backups.length}
          onClick={() => {
            act(async () => {
              const bridge = desktop();
              if (!bridge) throw Error("desktop_required");
              const session = await bridge.methods.kernelStatus();
              if (!session.ok) throw Error("session_changed");
              const reply = await bridge.methods.showBackupDirectory({
                projectPath: path,
                sessionGeneration: (
                  session.value as { sessionGeneration: number }
                ).sessionGeneration,
              });
              if (!reply.ok) throw Error(reply.error?.code);
            });
          }}
        >
          {en ? "Open backup folder" : "打开备份文件夹"}
        </Button>
      </div>
      {status?.interruptedRestore ? (
        <div role="status">
          <p>
            {en
              ? "A previous restore stopped while replacing files. Recover the preserved project before reopening it."
              : "上次恢复在替换文件时中断。请先恢复保留的项目状态，再重新打开。"}
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              act(async () => {
                await invoke("backup_recover");
                await refresh();
                setRestored(true);
                setMessage(
                  en
                    ? "The preserved project has been recovered. You can reopen it."
                    : "已恢复保留的项目状态，可以重新打开。",
                );
              });
            }}
          >
            {en ? "Recover interrupted restore" : "处理上次中断的恢复"}
          </Button>
        </div>
      ) : null}
      {status?.backups.length === 0 ? (
        <p>
          {en
            ? "No managed backups have been saved in this folder yet."
            : "此文件夹尚无托管备份。"}
        </p>
      ) : null}
      {status?.backups.length ? (
        <ul className="backup-list">
          {status.backups.map((backup) => (
            <li key={backup.backupId}>
              <p>
                <time>
                  {backup.createdAt
                    ? new Date(backup.createdAt).toLocaleString(
                        en ? "en" : "zh-CN",
                      )
                    : backup.backupId}
                </time>{" "}
                ·{" "}
                {backup.valid
                  ? en
                    ? "Verified"
                    : "已验证"
                  : en
                    ? "Verification failed"
                    : "验证未通过"}{" "}
                ·{" "}
                {backup.kind === "manual"
                  ? en
                    ? "Manual backup"
                    : "手动备份"
                  : backup.kind === "pre_restore"
                    ? en
                      ? "Before restore"
                      : "恢复前备份"
                    : en
                      ? "Before upgrade"
                      : "升级前备份"}
              </p>
              <Button
                disabled={busy || !backup.valid || status.interruptedRestore}
                onClick={() => {
                  act(async () => {
                    setPreview(
                      (await invoke("backup_restore_preview", {
                        backupId: backup.backupId,
                      })) as ManagedRestoreProjection,
                    );
                    setRestored(false);
                  });
                }}
              >
                {en ? "Preview restore" : "预览恢复"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {preview ? (
        <section aria-label={en ? "Restore preview" : "恢复预览"}>
          <h3>
            {en
              ? "Replace saved project with this backup?"
              : "用此备份替换已保存的项目？"}
          </h3>
          <p>
            {new Date(preview.createdAt).toLocaleString(en ? "en" : "zh-CN")} ·{" "}
            {Math.ceil(preview.databaseSizeBytes / 1024)} KB
          </p>
          <p>
            {en
              ? "Work saved after this backup will be kept in a separate pre-restore backup. You will confirm the replacement in an application dialog."
              : "此备份之后保存的工作会保存在单独的恢复前备份中。接下来会在应用确认窗口中核对是否替换。"}
          </p>
          <Button
            disabled={busy}
            variant="primary"
            onClick={() => {
              act(async () => {
                await invoke("backup_restore", {
                  backupId: preview.backupId,
                  confirmationNonce: preview.confirmationNonce,
                  expectedStateBinding: preview.stateBinding,
                });
                setPreview(undefined);
                setRestored(true);
                await refresh();
                setMessage(
                  en
                    ? "Backup restored and verified. Reopen the project to continue."
                    : "备份已恢复并验证。重新打开项目后可以继续工作。",
                );
              });
            }}
          >
            {en ? "Restore this backup" : "恢复此备份"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setPreview(undefined);
            }}
          >
            {en ? "Cancel restore" : "取消恢复"}
          </Button>
          <details>
            <summary>{en ? "Backup identity" : "备份身份"}</summary>
            <p>{preview.backupId}</p>
            <p>
              {en ? "Project" : "项目"}: {preview.projectId} · Schema{" "}
              {preview.databaseSchemaVersion}
            </p>
          </details>
        </section>
      ) : null}
      {restored ? (
        <Button disabled={busy} onClick={onReopen}>
          {en ? "Open recovered project" : "打开恢复后的项目"}
        </Button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
