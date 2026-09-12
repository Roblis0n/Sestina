import { useEffect, useRef, useState } from "react";
import { researchRoomApi, ResearchRoomApiError } from "../api/client.js";
import { Button } from "../components/primitives/Button.js";
import type { LocalJson } from "../api/kernel-dto.js";
import { desktop } from "../api/desktop.js";
import { DesktopRecovery } from "../components/product/DesktopRecovery.js";
import { DesktopSettingsMigration } from "../components/product/DesktopSettingsMigration.js";
const recentKey = "sestina.candidate.recent-projects";
function recents(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((p): p is string => typeof p === "string" && p.length < 4096)
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}
export function KernelStartCenter({
  en,
  onOpened,
  onBack,
}: {
  en: boolean;
  onOpened: (id: string, path: string, readOnly?: boolean) => void;
  onBack: () => void;
}) {
  const [path, setPath] = useState(""),
    [title, setTitle] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recent, setRecent] = useState(recents),
    [preview, setPreview] = useState<LocalJson>(),
    [notice, setNotice] = useState(""),
    [restore, setRestore] = useState<LocalJson>();
  const active = useRef(false);
  useEffect(() => {
    const update = () => {
      setRecent(recents());
    };
    window.addEventListener("sestina-preferences-imported", update);
    return () => {
      window.removeEventListener("sestina-preferences-imported", update);
    };
  }, []);
  const changePath = (next: string) => {
    setPath(next);
    setPreview(undefined);
    setRestore(undefined);
    setConfirmed(false);
    setError("");
  };
  const remember = (value: string) => {
    const values = [value, ...recents().filter((p) => p !== value)].slice(0, 8);
    localStorage.setItem(recentKey, JSON.stringify(values));
    setRecent(values);
    void desktop()?.methods.preferences({
      action: "save",
      input: { recentProjects: values },
    });
  };
  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      const code = failure instanceof ResearchRoomApiError ? failure.code : "";
      setError(
        code === "too_new"
          ? en
            ? "This project was saved by a newer version. Open it with that version."
            : "此项目由更新的版本保存，请使用对应版本打开。"
          : code === "stale_revision"
            ? en
              ? "The project changed after the preview. Check migration again."
              : "预览后项目已变化，请重新核对迁移。"
            : en
              ? "The project could not be opened. Check the folder, access permissions, or recovery options below. Existing files are kept."
              : "未能打开项目。请检查文件夹、访问权限或下方恢复选项。已有文件仍保留。 ",
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function open(readOnly = false) {
    const value = (await researchRoomApi.kernelOpen(path, readOnly)) as {
      projectId: string;
    };
    remember(path);
    onOpened(value.projectId, path, readOnly);
  }
  return (
    <section className="kernel-open">
      <h1>{en ? "Open your research" : "打开研究项目"}</h1>
      <p>
        {en
          ? "Choose a local folder. Only saved work can be recovered after closing this window."
          : "选择本地文件夹。关闭窗口后，只能恢复已经保存的工作。"}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => open());
        }}
      >
        <label>
          {en ? "Project folder" : "项目文件夹"}
          <input
            value={path}
            readOnly={Boolean(desktop())}
            required
            autoComplete="off"
            onChange={(e) => {
              changePath(e.target.value);
            }}
          />
        </label>
        {desktop() ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const bridge = desktop();
                if (!bridge) return;
                const reply = await bridge.methods.pickDirectory();
                if (!reply.ok) throw new Error("directory_unavailable");
                const value = reply.value as { path?: string };
                if (value.path) changePath(value.path);
              })
            }
          >
            {en ? "Choose folder" : "选择文件夹"}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={busy || !path.trim()}>
          {en ? "Open project" : "打开项目"}
        </Button>
      </form>
      <Button
        disabled={busy || !path.trim()}
        onClick={() => void run(() => open(true))}
      >
        {en ? "Browse read-only" : "只读浏览"}
      </Button>
      <details>
        <summary>
          {en ? "Create a project in this folder" : "在此文件夹创建项目"}
        </summary>
        <label>
          {en ? "Project title" : "项目名称"}
          <input
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
            }}
          />
          {en
            ? "Create a local .sestina folder here. Existing project folders will not be overwritten."
            : "在此创建本地 .sestina 文件夹，不覆盖已有项目。"}
        </label>
        <Button
          disabled={busy || !confirmed || !path.trim() || !title.trim()}
          onClick={() =>
            void run(async () => {
              const value = await researchRoomApi.kernelCreate(path, title);
              if (!value.projectId) throw new Error("missing_project");
              remember(path);
              onOpened(value.projectId, path, false);
            })
          }
        >
          {en ? "Create project" : "创建项目"}
        </Button>
      </details>
      <details>
        <summary>{en ? "Migration and recovery" : "迁移与恢复"}</summary>
        <p>
          {en
            ? "Check an older project before migrating it. Recovery verifies the saved journal and backup; it never resumes a model request."
            : "迁移旧项目前先核对。恢复会验证保存的日志和备份，不会继续模型请求。"}
        </p>
        <Button
          disabled={busy || !path.trim()}
          onClick={() =>
            void run(async () => {
              setPreview(
                await researchRoomApi.kernelMaintenance({
                  projectPath: path,
                  action: "preview",
                }),
              );
            })
          }
        >
          {en ? "Check migration" : "核对迁移"}
        </Button>
        {preview ? (
          <>
            <p>
              {en
                ? "Research objects will be preserved. Old workflows become read-only history. A verified backup is kept before migration."
                : "保留研究对象，旧流程转为只读历史；迁移前会保留经过验证的备份。"}
            </p>
            <details>
              <summary>
                {en ? "Inspect migration details" : "查看迁移明细"}
              </summary>
              <pre>{JSON.stringify(preview, null, 2)}</pre>
            </details>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const hash = (preview as { previewHash: string }).previewHash;
                  await researchRoomApi.kernelMaintenance({
                    projectPath: path,
                    action: "migrate",
                    confirmed: true,
                    previewHash: hash,
                  });
                  await open();
                })
              }
            >
              {en ? "Confirm migration and open" : "确认迁移并打开"}
            </Button>
          </>
        ) : null}
        <Button
          disabled={busy || !path.trim()}
          onClick={() =>
            void run(async () => {
              const result = await researchRoomApi.kernelMaintenance({
                projectPath: path,
                action: "recover",
                confirmed: true,
              });
              setNotice(
                (result as { stage: string }).stage === "swapped"
                  ? en
                    ? "Recovery completed. Open the project to continue."
                    : "恢复已完成，请打开项目继续。"
                  : en
                    ? "The original project was restored. Check migration before opening this candidate."
                    : "已恢复原始项目，请核对迁移后再打开候选应用。",
              );
            })
          }
        >
          {en ? "Recover interrupted migration" : "恢复中断的迁移"}
        </Button>
        <Button
          disabled={busy || !path.trim()}
          onClick={() =>
            void run(async () => {
              setRestore(
                await researchRoomApi.kernelMaintenance({
                  projectPath: path,
                  action: "restore_preview",
                }),
              );
            })
          }
        >
          {en ? "Check the pre-migration backup" : "核对迁移前备份"}
        </Button>
        {restore ? (
          <>
            <p>
              {en
                ? "Restoring this verified backup returns the project to its pre-migration state. Later research changes will no longer be current. Restoration is refused if it could bring back forgotten content."
                : "恢复这份已验证备份会回到迁移前状态，之后的研究变更将不再是当前状态。若可能带回已忘记内容，恢复会被拒绝。"}
            </p>
            <details>
              <summary>
                {en ? "Inspect the restore binding" : "查看恢复绑定"}
              </summary>
              <pre>{JSON.stringify(restore, null, 2)}</pre>
            </details>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await researchRoomApi.kernelMaintenance({
                    projectPath: path,
                    action: "restore",
                    previewHash: (restore as { previewHash: string })
                      .previewHash,
                    confirmed: true,
                  });
                  setRestore(undefined);
                  setPreview(undefined);
                  setNotice(
                    en
                      ? "Pre-migration state restored. Check migration to continue in this candidate."
                      : "已恢复迁移前状态。请核对迁移后继续使用候选应用。",
                  );
                })
              }
            >
              {en
                ? "Confirm restore to the pre-migration state"
                : "确认恢复迁移前状态"}
            </Button>
          </>
        ) : null}
        <Button
          disabled={busy || !path.trim()}
          onClick={() =>
            void run(async () => {
              await researchRoomApi.repairKernelBrief(path);
              await open();
            })
          }
        >
          {en ? "Recreate missing file and open" : "重建缺失文件并打开"}
        </Button>
      </details>
      {recent.length ? (
        <section>
          <h2>{en ? "Recent projects" : "最近项目"}</h2>
          <p>
            {en
              ? "This list stores folder locations on this device, without research content."
              : "此列表只在本机保存文件夹位置，不保存研究正文。"}
          </p>
          <ul>
            {recent.map((p) => (
              <li key={p}>
                <Button
                  variant="quiet"
                  onClick={() => {
                    if (desktop())
                      void run(async () => {
                        const bridge = desktop();
                        if (!bridge) throw Error("desktop_required");
                        const reply = await bridge.methods.pickDirectory({
                          initialPath: p,
                        });
                        if (!reply.ok) throw Error("directory_unavailable");
                        const value = reply.value as { path?: string };
                        if (value.path) changePath(value.path);
                      });
                    else changePath(p);
                  }}
                >
                  {p}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            onClick={() => {
              localStorage.removeItem(recentKey);
              setRecent([]);
              void desktop()?.methods.preferences({
                action: "save",
                input: { recentProjects: [] },
              });
            }}
          >
            {en ? "Clear recent locations" : "清除最近位置"}
          </Button>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {desktop() ? (
        <DesktopRecovery
          key={path}
          en={en}
          path={path}
          busy={busy}
          run={run}
          onReopen={() => void run(() => open())}
        />
      ) : null}
      {desktop() ? <DesktopSettingsMigration en={en} /> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy ? (
        <p role="status">
          {en ? "Working with the local project…" : "正在处理本地项目…"}
        </p>
      ) : null}
      {!desktop() ? (
        <Button disabled={busy} onClick={onBack}>
          {en ? "Back" : "返回"}
        </Button>
      ) : null}
    </section>
  );
}
