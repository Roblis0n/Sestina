import { useEffect, useState, type RefObject } from "react";
import { researchRoomApi, ResearchRoomApiError } from "../../api/client.js";
import type { AppLanguage, ExecutedProjectStateRestoreDto, PreparedProjectStateRestoreDto, ProjectRecoveryStatusDto } from "../../api/dto.js";
import { Button } from "../primitives/Button.js";
import { Modal } from "../primitives/Modal.js";
import { StatusBadge } from "../primitives/StatusBadge.js";

interface RecoveryDialogProps {
  readonly open: boolean;
  readonly language: AppLanguage;
  readonly busy: boolean;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onRestored: (result: ExecutedProjectStateRestoreDto) => Promise<void>;
  readonly onNotice: (message: string, tone?: "ready" | "warning" | "danger") => void;
}

function c(language: AppLanguage, en: string, zh: string): string { return language === "en" ? en : zh; }
function bytes(value: number): string { return value < 1_024 ? `${value} B` : value < 1_048_576 ? `${(value / 1_024).toFixed(1)} KiB` : `${(value / 1_048_576).toFixed(1)} MiB`; }
function timestamp(value?: string): string { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }

export function RecoveryDialog(props: RecoveryDialogProps) {
  const [status, setStatus] = useState<ProjectRecoveryStatusDto>();
  const [prepared, setPrepared] = useState<PreparedProjectStateRestoreDto>();
  const [restored, setRestored] = useState<ExecutedProjectStateRestoreDto>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    setWorking(true); setError(undefined);
    try { setStatus(await researchRoomApi.projectRecovery()); }
    catch (failure) { setError(failure instanceof Error ? failure.message : c(props.language, "Recovery status is unavailable.", "恢复状态不可用。")); }
    finally { setWorking(false); }
  }

  useEffect(() => {
    if (!props.open) { setPrepared(undefined); setRestored(undefined); setAcknowledged(false); setError(undefined); return; }
    void refresh();
  }, [props.open]);

  async function createBackup() {
    setWorking(true); setError(undefined);
    try {
      const backup = await researchRoomApi.createProjectBackup();
      props.onNotice(c(props.language, `Verified backup ${backup.backupId} was created locally.`, `已在本机创建并验证备份 ${backup.backupId}。`), "ready");
      setPrepared(undefined); setRestored(undefined); setStatus(await researchRoomApi.projectRecovery());
    } catch (failure) { setError(failure instanceof Error ? failure.message : c(props.language, "The backup could not be created.", "无法创建备份。")); }
    finally { setWorking(false); }
  }

  async function preview(backupId: string) {
    setWorking(true); setError(undefined); setRestored(undefined); setAcknowledged(false);
    try { setPrepared(await researchRoomApi.prepareProjectRestore(backupId)); }
    catch (failure) { setPrepared(undefined); setError(failure instanceof Error ? failure.message : c(props.language, "The restore preview could not be verified.", "无法验证恢复预览。")); }
    finally { setWorking(false); }
  }

  async function execute() {
    if (!prepared || !acknowledged) return;
    setWorking(true); setError(undefined);
    try {
      const result = await researchRoomApi.executeProjectRestore(prepared);
      setRestored(result); setPrepared(undefined); setAcknowledged(false);
      await props.onRestored(result);
      setStatus(await researchRoomApi.projectRecovery());
    } catch (failure) {
      const apiError = failure instanceof ResearchRoomApiError ? failure : undefined;
      setError(apiError?.code === "confirmation_expired"
        ? c(props.language, "This confirmation expired. Preview the backup again.", "本次确认已过期，请重新预览备份。")
        : apiError?.code === "confirmation_replayed"
          ? c(props.language, "This one-time confirmation was already used. Preview again before another restore.", "该一次性确认已使用；如需再次恢复，请重新预览。")
          : apiError?.code === "confirmation_binding_mismatch"
            ? c(props.language, "The project, backup, session, or current state changed. Nothing was restored; preview again.", "项目、备份、会话或当前状态已变化；本次未执行恢复，请重新预览。")
            : failure instanceof Error ? failure.message : c(props.language, "Restore failed and did not claim success.", "恢复失败，系统未声称成功。"));
      setPrepared(undefined); setAcknowledged(false);
      try { setStatus(await researchRoomApi.projectRecovery()); } catch { /* keep the actionable restore error */ }
    } finally { setWorking(false); }
  }

  const blocked = props.busy || working;
  const stateTone = status?.currentState === "healthy" ? "ready" : "danger";
  return <Modal open={props.open} title={c(props.language, "Backup & recovery", "备份与恢复")} description={c(props.language, "Local project state only. No research content is uploaded, and restore always requires a fresh exact preview.", "只处理本地项目状态；不会上传研究内容，恢复前始终需要重新生成并确认精确预览。")} closeLabel={c(props.language, "Close backup and recovery", "关闭备份与恢复")} returnFocusRef={props.returnFocusRef} onClose={props.onClose} className="recovery-modal">
    <div className="recovery-dialog" aria-busy={blocked}>
      {error ? <div className="recovery-error" role="alert"><strong>{c(props.language, "Recovery stopped", "恢复已停止")}</strong><p>{error}</p></div> : null}
      {!status ? <p role="status">{c(props.language, "Inspecting the local project and managed backups…", "正在检查本地项目与受管备份……")}</p> : <>
        <section className="recovery-health" aria-labelledby="recovery-health-title">
          <div><p className="eyebrow">{c(props.language, "Current state", "当前状态")}</p><h3 id="recovery-health-title">{c(props.language, "Project integrity", "项目完整性")}</h3></div>
          <StatusBadge tone={stateTone}>{status.currentState}</StatusBadge>
          <dl>
            <div><dt>{c(props.language, "Database", "数据库")}</dt><dd>{status.databaseIntegrity}</dd></div>
            <div><dt>{c(props.language, "Research Brief binding", "Research Brief 绑定")}</dt><dd>{status.currentBriefBinding}</dd></div>
            <div><dt>{c(props.language, "Schema", "Schema")}</dt><dd>{status.schema.status}{status.schema.version ? ` · ${status.schema.version} / ${status.schema.supportedMinimum}–${status.schema.supportedVersion}` : ` · ${status.schema.supportedMinimum}–${status.schema.supportedVersion}`}</dd></div>
            <div><dt>{c(props.language, "Network", "网络")}</dt><dd>{c(props.language, "Not used", "未使用")}</dd></div>
          </dl>
          {status.schema.status === "too_new" ? <p className="recovery-boundary">{c(props.language, "This project was written by a newer schema. This release refuses to start or downgrade it. Install a compatible release; only a separately verified managed backup can be restored.", "该项目由更新的 schema 写入；当前版本拒绝启动或降级。请安装兼容版本；只有另行验证通过的受管备份可以恢复。")}</p> : null}
          {status.schema.status === "too_old" ? <p className="recovery-boundary">{c(props.language, "This project predates the supported upgrade window. This release refuses an unverified migration. Open it with a compatible intermediate release first.", "该项目早于当前支持的升级窗口；本版本拒绝未经验证的迁移。请先使用兼容的中间版本打开。")}</p> : null}
          {status.schema.status === "migration_failed" ? <p className="recovery-boundary">{c(props.language, `Migration ${status.schema.failedVersion ?? "—"} failed. The App stopped without retrying; restore the verified pre-upgrade bundle or repair the migration cause before reopening.`, `迁移 ${status.schema.failedVersion ?? "—"} 失败。App 已停止且不会自动重试；请恢复已验证的升级前备份，或先修复迁移失败原因。`)}</p> : null}
          <div className="button-row"><Button type="button" disabled={blocked || status.currentState !== "healthy"} onClick={() => void createBackup()}>{c(props.language, "Create verified backup", "创建已验证备份")}</Button><Button type="button" variant="quiet" disabled={blocked} onClick={() => void refresh()}>{c(props.language, "Refresh", "刷新")}</Button></div>
        </section>

        <section className="recovery-backups" aria-labelledby="recovery-backups-title">
          <div className="section-heading"><div><p className="eyebrow">{c(props.language, "Managed choices only", "仅限受管选项")}</p><h3 id="recovery-backups-title">{c(props.language, "Verified recovery bundles", "已验证恢复包")}</h3></div><span>{status.backups.length}</span></div>
          {status.backups.length === 0 ? <p className="empty-state">{c(props.language, "No managed backup exists. The App will not accept an arbitrary filesystem path as a restore source.", "当前没有受管备份；App 不接受任意文件系统路径作为恢复源。")}</p> : <ol>
            {status.backups.map((backup) => <li key={backup.backupId} data-valid={backup.valid}>
              <div><strong>{backup.kind === "manual" ? c(props.language, "Manual backup", "手动备份") : backup.kind === "pre_upgrade" ? c(props.language, "Pre-upgrade safety backup", "升级前安全备份") : c(props.language, "Pre-restore safety backup", "恢复前安全备份")}</strong><code>{backup.backupId}</code><small>{timestamp(backup.createdAt)} · schema {backup.databaseSchemaVersion ?? "—"} · {backup.databaseSizeBytes === undefined ? "—" : bytes(backup.databaseSizeBytes)} + {backup.briefSizeBytes === undefined ? "—" : bytes(backup.briefSizeBytes)}</small></div>
              <div><StatusBadge tone={backup.valid ? "ready" : "danger"}>{backup.verification}</StatusBadge><Button type="button" variant="secondary" disabled={blocked || !backup.valid} onClick={() => void preview(backup.backupId)}>{c(props.language, "Preview restore", "预览恢复")}</Button></div>
            </li>)}
          </ol>}
        </section>

        {prepared ? <section className="recovery-confirmation" aria-labelledby="recovery-confirm-title">
          <p className="eyebrow">{c(props.language, "Destructive boundary", "破坏性操作边界")}</p><h3 id="recovery-confirm-title">{c(props.language, "Confirm this exact restore", "确认本次精确恢复")}</h3>
          <p>{c(props.language, "The current state will first be preserved as a complete pre-restore bundle, or as a forensic copy if it is damaged. The selected DB and Research Brief are then replaced together and verified before the project reopens.", "当前状态会先保存为完整的恢复前备份；若当前状态已损坏，则保存法证副本。随后所选数据库与 Research Brief 会一并替换，并在项目重新打开前完成验证。")}</p>
          <dl>
            <div><dt>{c(props.language, "Backup", "备份")}</dt><dd><code>{prepared.backupId}</code></dd></div>
            <div><dt>{c(props.language, "Created", "创建时间")}</dt><dd>{timestamp(prepared.createdAt)}</dd></div>
            <div><dt>{c(props.language, "Schema / runtime", "Schema / 运行时")}</dt><dd>{prepared.databaseSchemaVersion} / {prepared.runtimeVersion}</dd></div>
            <div><dt>Manifest SHA-256</dt><dd><code>{prepared.manifestHash}</code></dd></div>
            <div><dt>{c(props.language, "State binding", "状态绑定")}</dt><dd><code>{prepared.stateBinding}</code></dd></div>
            <div><dt>{c(props.language, "Confirmation expires", "确认到期")}</dt><dd>{timestamp(prepared.expiresAt)}</dd></div>
          </dl>
          <label className="check-line"><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); }} /><span>{c(props.language, "I reviewed this exact backup and state binding and authorize replacing the current local project state.", "我已核对本次精确备份与状态绑定，并授权替换当前本地项目状态。")}</span></label>
          <div className="form-actions"><Button type="button" variant="quiet" disabled={blocked} onClick={() => { setPrepared(undefined); setAcknowledged(false); }}>{c(props.language, "Cancel", "取消")}</Button><Button type="button" variant="danger" disabled={blocked || !acknowledged} onClick={() => { void execute(); }}>{c(props.language, "Restore and reopen", "恢复并重新打开")}</Button></div>
        </section> : null}

        {restored ? <section className="recovery-result" aria-labelledby="recovery-result-title">
          <StatusBadge tone="ready">{c(props.language, "Restored and reopened", "已恢复并重新打开")}</StatusBadge><h3 id="recovery-result-title">{c(props.language, "Verified recovery result", "已验证恢复结果")}</h3>
          <dl><div><dt>{c(props.language, "Source backup", "来源备份")}</dt><dd><code>{restored.backupId}</code></dd></div><div><dt>{c(props.language, "Current state preserved as", "当前状态已保存为")}</dt><dd><code>{restored.preRestoreBackupId}</code></dd></div><div><dt>Source Manifest</dt><dd><code>{restored.sourceManifestHash}</code></dd></div><div><dt>{c(props.language, "Post-restore binding", "恢复后绑定")}</dt><dd><code>{restored.postRestoreStateBinding}</code></dd></div><div><dt>{c(props.language, "Rollback needed", "是否执行回滚")}</dt><dd>{c(props.language, "No — commit and verification completed", "否——提交与验证已完成")}</dd></div></dl>
          <Button type="button" variant="primary" onClick={props.onClose}>{c(props.language, "Return to Research Room", "返回 Research Room")}</Button>
        </section> : null}
      </>}
    </div>
  </Modal>;
}
