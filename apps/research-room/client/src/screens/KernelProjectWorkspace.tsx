import { useEffect, useState } from "react";
import { researchRoomApi } from "../api/client.js";
import {
  decodeLocalJson,
  decodeReview,
  type KernelReviewDto,
} from "../api/kernel-dto.js";
import { ProjectBriefPanel } from "../components/product/ProjectBriefPanel.js";
import { KernelReviewPanel } from "../components/product/KernelReviewPanel.js";
import { KernelMemoryPanel } from "../components/product/KernelMemoryPanel.js";
import { KernelConnectionsPanel } from "../components/product/KernelConnectionsPanel.js";
import { KernelHistoryPanel } from "../components/product/KernelHistoryPanel.js";
import { Button } from "../components/primitives/Button.js";
import { kernelLabel } from "../components/product/kernel-copy.js";
import "../styles/kernel-workspace.css";

export function KernelProjectWorkspace({
  language,
  onBack,
}: {
  language: string;
  onBack: () => void;
}) {
  const en = language === "en";
  const [projectId, setProjectId] = useState<string>();
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<KernelReviewDto[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [reviewId, setReviewId] = useState<string>();
  const [briefDraft, setBriefDraft] = useState<KernelReviewDto>();
  const [workspace, setWorkspace] = useState<
    "brief" | "reviews" | "connections" | "history" | "memory"
  >("brief");
  const [suggestion, setSuggestion] = useState("");
  async function load(id = projectId, next?: string) {
    if (!id) return;
    const p = (await researchRoomApi.kernel(
      id,
      "list",
      { limit: 20, ...(next ? { cursor: next } : {}) },
      decodeLocalJson,
    )) as unknown as { items: KernelReviewDto[]; nextCursor?: string };
    setReviews(p.items);
    setCursor(p.nextCursor);
  }
  useEffect(() => {
    void researchRoomApi
      .kernelSession()
      .then((v) => {
        const id = (v as { projectId: string | null }).projectId;
        if (id) {
          setProjectId(id);
          void load(id);
          const savedReview = new URLSearchParams(window.location.search).get("review");
          if (savedReview && /^rrvw_[a-zA-Z0-9_-]+$/.test(savedReview)) { setReviewId(savedReview); setWorkspace("reviews"); }
        }
      })
      .catch(() => {
        setError(
          en
            ? "The local session is unavailable."
            : "本地会话不可用，请重新打开项目。",
        );
      });
  }, []);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      setError(
        en
          ? "Could not complete this action. Check the project and retry explicitly."
          : "未能完成操作，请核对项目后再试。",
      );
    } finally {
      setBusy(false);
    }
  }
  function openReview(r: KernelReviewDto) {
    window.history.replaceState(null, "", `/project/kernel?review=${encodeURIComponent(r.id)}`);
    setReviewId(r.id);
    setWorkspace("reviews");
    void load();
  }
  return (
    <main id="main-content" className="kernel-workspace">
      {!projectId ? (
        <section className="kernel-open">
          <h1>{en ? "Open a migrated project" : "打开已迁移项目"}</h1>
          <p>
            {en
              ? "Choose a project already prepared for persistent reviews."
              : "选择已经完成迁移、可保存持续审议的项目。"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const v = (await researchRoomApi.kernelOpen(path)) as {
                  projectId: string;
                };
                setProjectId(v.projectId);
                const savedReview = new URLSearchParams(window.location.search).get("review");
                if (savedReview && /^rrvw_[a-zA-Z0-9_-]+$/.test(savedReview)) { setReviewId(savedReview); setWorkspace("reviews"); }
                await load(v.projectId);
              });
            }}
          >
            <label>
              {en ? "Project folder" : "项目文件夹"}
              <input
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                }}
                autoComplete="off"
                required
              />
            </label>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !path.trim()}
            >
              {en ? "Open project" : "打开项目"}
            </Button>
          </form>
          {error && path.trim() ? <details><summary>{en ? "Repair a missing Brief file" : "修复缺失的简报文件"}</summary>
            <p>{en ? "If only the local Brief file is missing, recreate it from the verified database. Existing files and research objects will not be overwritten." : "如果只是本地简报文件缺失，可从验证过的数据库重新生成。已有文件和研究对象不会被覆盖。"}</p>
            <Button disabled={busy} onClick={() => void run(async () => {
              await researchRoomApi.repairKernelBrief(path);
              const opened=await researchRoomApi.kernelOpen(path) as {projectId:string};
              setProjectId(opened.projectId);await load(opened.projectId);
            })}>{en ? "Recreate missing file and open" : "重建缺失文件并打开"}</Button>
          </details> : null}
          <Button onClick={onBack}>{en ? "Back" : "返回"}</Button>
        </section>
      ) : (
        <>
          <aside
            className="kernel-navigation"
            aria-label={en ? "Project tools" : "项目工具"}
          >
            <Button
              aria-pressed={workspace === "brief"}
              onClick={() => {
                setBriefDraft(undefined);
                window.history.replaceState(null, "", "/project/kernel");
                setWorkspace("brief");
              }}
            >
              {en ? "Research Brief" : "研究简报"}
            </Button>
            <Button
              aria-pressed={workspace === "reviews"}
              onClick={() => {
                setWorkspace("reviews");
                setReviewId(undefined);
              }}
            >
              {en ? "Saved reviews" : "已保存审议"}
            </Button>
            <Button
              aria-pressed={workspace === "memory"}
              onClick={() => {
                setWorkspace("memory");
              }}
            >
              {en ? "Project context" : "项目上下文"}
            </Button>
            <Button
              aria-pressed={workspace === "connections"}
              onClick={() => {
                setWorkspace("connections");
              }}
            >
              {en ? "Draft connections" : "草稿连接"}
            </Button>
            <Button
              aria-pressed={workspace === "history"}
              onClick={() => {
                setWorkspace("history");
              }}
            >
              {en ? "Historical workflows" : "历史流程"}
            </Button>
            <Button onClick={() => { window.history.replaceState(null, "", "/project/kernel"); onBack(); }}>
              {en ? "Switch project" : "切换项目"}
            </Button>
          </aside>
          <div className="kernel-content">
            {workspace === "memory" ? (
              <KernelMemoryPanel projectId={projectId} en={en} />
            ) : workspace === "connections" ? (
              <KernelConnectionsPanel
                projectId={projectId}
                en={en}
                onReview={openReview}
              />
            ) : workspace === "history" ? (
              <KernelHistoryPanel
                projectId={projectId}
                en={en}
                onReview={openReview}
              />
            ) : workspace === "brief" ? (
              <ProjectBriefPanel
                key={briefDraft?.id ?? "active"}
                candidate={briefDraft}
                projectId={projectId}
                language={language}
                onReview={openReview}
              />
            ) : reviewId ? (
              <KernelReviewPanel
                onEditBrief={(review) => { setBriefDraft(review); setWorkspace("brief"); }}
                key={reviewId}
                projectId={projectId}
                reviewId={reviewId}
                language={language}
                onReview={openReview}
                onChanged={() => {
                  void load();
                }}
              />
            ) : (
              <section>
                <h1>{en ? "Saved reviews" : "已保存审议"}</h1>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const r = await researchRoomApi.kernel(
                        projectId,
                        "create",
                        { suggestion },
                        decodeReview,
                      );
                      setSuggestion("");
                      openReview(r);
                    });
                  }}
                >
                  <label>
                    {en ? "New suggestion" : "新的建议"}
                    <textarea
                      value={suggestion}
                      onChange={(e) => {
                        setSuggestion(e.target.value);
                      }}
                      maxLength={65536}
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || !suggestion.trim()}
                  >
                    {en ? "Save draft" : "保存草稿"}
                  </Button>
                </form>
                <ul className="kernel-review-list">
                  {reviews.map((r) => (
                    <li key={r.id}>
                      <Button
                        onClick={() => {
                          openReview(r);
                        }}
                      >
                        {r.suggestion}
                      </Button>
                      <small>{kernelLabel(r.status,en)}</small>
                    </li>
                  ))}
                </ul>
                {!reviews.length ? (
                  <p>{en ? "No saved reviews yet." : "还没有保存的审议。"}</p>
                ) : null}
                <div className="brief-actions">
                  <Button
                    disabled={busy}
                    onClick={() => void run(() => load())}
                  >
                    {en ? "Reload list" : "重新读取列表"}
                  </Button>
                  <Button
                    disabled={busy || !cursor}
                    onClick={() => void run(() => load(projectId, cursor))}
                  >
                    {en ? "Next page" : "下一页"}
                  </Button>
                </div>
              </section>
            )}
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="persistent-message">
          {error}
        </p>
      ) : null}
    </main>
  );
}
