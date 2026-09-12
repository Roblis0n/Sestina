import { useEffect, useRef, useState } from "react";
import type { DesktopUpdateProjection } from "@sestina/application-ports";
import { desktop } from "../../api/desktop.js";
import { Button } from "../primitives/Button.js";
export function DesktopAbout({
  en,
  guard = (action) => {
    action();
  },
}: {
  en: boolean;
  guard?: (action: () => void) => void;
}) {
  const [info, setInfo] = useState<unknown>();
  const [state, setState] = useState<DesktopUpdateProjection>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void desktop()
      ?.methods.about()
      .then((result) => {
        if (live.current && result.ok) setInfo(result.value);
      });
    void desktop()
      ?.methods.update({ action: "status" })
      .then((result) => {
        if (live.current && result.ok)
          setState(result.value as DesktopUpdateProjection);
      });
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      void desktop()
        ?.methods.update({ action: "status" })
        .then((reply) => {
          if (live.current && reply.ok)
            setState(reply.value as DesktopUpdateProjection);
        });
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [busy]);
  async function act(action: string) {
    setError("");
    if (action !== "cancel") setBusy(true);
    try {
      const result = await desktop()?.methods.update({ action });
      if (!live.current) return;
      if (!result?.ok) throw Error(result?.error?.code);
      setState(result.value as DesktopUpdateProjection);
    } catch (failure) {
      if (live.current)
        setError(
          failure instanceof Error &&
            failure.message === "confirmation_declined"
            ? en
              ? "Installation cancelled. The update has not been installed."
              : "已取消安装，更新尚未安装。"
            : en
              ? "The operation could not finish. Check the update status and try again when ready."
              : "操作未能完成。请检查更新状态，准备好后再试。",
        );
    } finally {
      if (live.current && action !== "cancel") setBusy(false);
    }
  }
  const messages: Record<DesktopUpdateProjection["stage"], string> = {
    not_checked: en ? "Updates have not been checked." : "尚未检查更新。",
    source_unavailable: en
      ? "A trusted update source is not configured for this internal candidate. Your current program remains available."
      : "此内部候选尚未配置可信更新源，当前程序仍可使用。",
    checking: en
      ? "Checking the trusted update source…"
      : "正在检查可信更新源…",
    available: en
      ? "An update is available. Download it to verify the installer before deciding to install."
      : "发现可用更新。先下载并验证安装文件，再决定是否安装。",
    downloading: en ? "Downloading the installer…" : "正在下载安装文件…",
    verified: en
      ? "The installer has been verified. The update has not been installed. Installation will protect saved project data and close this program."
      : "安装文件已验证，更新尚未安装。安装前会保护已保存的项目数据，并关闭当前程序。",
    preparing_install: en
      ? "Protecting saved project data and verifying the previous program…"
      : "正在保护已保存的项目数据并核验旧程序…",
    installing: en
      ? "The installer has started. Follow its instructions, then reopen Sestina."
      : "安装程序已启动。请按其提示操作，完成后重新打开 Sestina。",
    installed: en
      ? "The reopened program matches the checked update. Open your project to continue."
      : "重开的程序与已核验的更新一致。打开项目后可以继续工作。",
    cancelled: en
      ? "Download cancelled. The update has not been installed. Check again when you want to continue."
      : "下载已取消，更新尚未安装。需要继续时请重新检查更新。",
    failed: en
      ? "The update could not finish. It will not retry automatically. Keep using the current program, or inspect recovery options below."
      : "更新未能完成，不会自动重试。可以继续使用当前程序，或查看下方恢复选项。",
    interrupted: en
      ? "The previous update stopped before completion could be confirmed. Nothing will resume automatically. Check again, or open the verified previous program."
      : "上次更新停止后，尚未确认是否完成。程序不会自动继续。可以重新检查，或打开经过验证的旧程序。",
  };
  return (
    <section>
      <p>
        {en
          ? "Internal desktop candidate. The published preview remains v0.2.0. This candidate has not been publicly released."
          : "当前为内部桌面候选。已发布预览仍为 v0.2.0，此候选尚未公开发行。"}
      </p>
      <p>
        {en
          ? "Projects stay in the folders you choose. Uninstalling the program keeps your projects and backups."
          : "项目保存在你选择的文件夹。卸载程序会保留项目和备份。"}
      </p>
      <h2>{en ? "Updates" : "更新"}</h2>
      <p role="status">{messages[state?.stage ?? "not_checked"]}</p>
      {state?.version ? (
        <p>
          {en ? "Checked version" : "已核验版本"}：{state.version} ·{" "}
          {state.channel === "internal_candidate"
            ? en
              ? "Internal candidate"
              : "内部候选"
            : en
              ? "Stable"
              : "正式版本"}
        </p>
      ) : null}
      {state?.stage === "downloading" ? (
        <>
          <progress
            max={state.size ?? 1}
            value={state.received}
            aria-label={en ? "Installer download" : "安装文件下载"}
          />
          <p>
            {Math.ceil(state.received / 1024)} /{" "}
            {Math.ceil((state.size ?? 0) / 1024)} KB
          </p>
        </>
      ) : null}
      <div className="action-row">
        <Button disabled={busy} onClick={() => void act("check")}>
          {en ? "Check for updates" : "检查更新"}
        </Button>
        {state?.stage === "available" ? (
          <Button disabled={busy} onClick={() => void act("download")}>
            {en ? "Download update" : "下载更新"}
          </Button>
        ) : null}
        {state?.stage === "checking" || state?.stage === "downloading" ? (
          <Button onClick={() => void act("cancel")}>
            {en ? "Cancel" : "取消"}
          </Button>
        ) : null}
        {state?.stage === "verified" ? (
          <Button
            disabled={busy}
            variant="primary"
            onClick={() => {
              guard(() => void act("install"));
            }}
          >
            {en ? "Install verified update" : "安装已验证的更新"}
          </Button>
        ) : null}
        {state?.rollbackAvailable ? (
          <Button
            disabled={busy}
            onClick={() => {
              guard(() => void act("recover_program"));
            }}
          >
            {en ? "Open previous program" : "打开旧程序"}
          </Button>
        ) : null}
      </div>
      {state?.backupId ? (
        <p>
          {en ? "Before-upgrade backup" : "升级前备份"}：{state.backupId}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <details>
        <summary>{en ? "Application details" : "应用详情"}</summary>
        <pre>
          {JSON.stringify({ application: info, update: state }, null, 2)}
        </pre>
      </details>
    </section>
  );
}
