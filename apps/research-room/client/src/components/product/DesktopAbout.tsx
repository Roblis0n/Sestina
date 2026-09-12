import { useEffect, useState } from "react";
import { desktop } from "../../api/desktop.js";
import { Button } from "../primitives/Button.js";
export function DesktopAbout({ en }: { en: boolean }) {
  const [info, setInfo] = useState<unknown>();
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void desktop()
      ?.methods.about()
      .then((result) => {
        if (result.ok) setInfo(result.value);
      });
  }, []);
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
      <p>
        {en
          ? "Updates have not been checked. Checks and downloads require your action."
          : "尚未检查更新。只有你主动操作，才会检查或下载。"}
      </p>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void desktop()
            ?.methods.checkUpdate()
            .then((result) => {
              setMessage(
                result.ok
                  ? en
                    ? "A trusted update source is not configured for this internal candidate. Your current program and projects are unchanged."
                    : "此内部候选尚未配置可信更新源。当前程序和项目保持原状。"
                  : en
                    ? "The update could not be checked. Your current program is kept."
                    : "未能检查更新，当前程序仍可使用。",
              );
            })
            .catch(() => {
              setMessage(
                en ? "The update could not be checked." : "未能检查更新。",
              );
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {en ? "Check for updates" : "检查更新"}
      </Button>
      {message ? (
        <p role="status" className="persistent-message">
          {message}
        </p>
      ) : null}
      <details>
        <summary>{en ? "Application details" : "应用详情"}</summary>
        <pre>{JSON.stringify(info, null, 2)}</pre>
      </details>
    </section>
  );
}
