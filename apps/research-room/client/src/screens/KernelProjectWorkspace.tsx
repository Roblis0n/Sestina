import { KernelMemoryDrawer } from "../components/product/KernelMemoryDrawer.js";
import { KernelNewReview } from "../components/product/KernelNewReview.js";
import { KernelResultDetail } from "../components/product/KernelResultDetail.js";
import { KernelStartCenter } from "./KernelStartCenter.js";
import { useEffect, useRef, useState } from "react";
import { researchRoomApi } from "../api/client.js";
import { decodeLocalJson, type KernelReviewDto } from "../api/kernel-dto.js";
import {
  decodeWorkspace,
  type WorkspaceDto,
  type WorkspaceEntryDto,
} from "../api/workspace-dto.js";
import { parseKernelRoute } from "../routing/kernel-route.js";
import { ProjectBriefPanel } from "../components/product/ProjectBriefPanel.js";
import { KernelReviewPanel } from "../components/product/KernelReviewPanel.js";
import { KernelMemoryPanel } from "../components/product/KernelMemoryPanel.js";
import { KernelConnectionsPanel } from "../components/product/KernelConnectionsPanel.js";
import { KernelHistoryPanel } from "../components/product/KernelHistoryPanel.js";
import { Button } from "../components/primitives/Button.js";
import { Modal } from "../components/primitives/Modal.js";
import { kernelLabel } from "../components/product/kernel-copy.js";
import { desktop } from "../api/desktop.js";
import { DesktopAbout } from "../components/product/DesktopAbout.js";
import "../styles/kernel-workspace.css";

interface LeaveRequest {
  save?: () => Promise<void>;
  discard?: () => void;
  proceed: () => void;
}
function historyIndex(fallback: number) {
  const state: unknown = window.history.state;
  if (
    state &&
    typeof state === "object" &&
    "sestinaPosition" in state &&
    typeof state.sestinaPosition === "number" &&
    Number.isSafeInteger(state.sestinaPosition)
  )
    return state.sestinaPosition;
  return fallback;
}
export function KernelProjectWorkspace({
  language,
  onBack,
  onSettings,
}: {
  language: string;
  onBack: () => void;
  onSettings: (section: string) => void;
}) {
  const en = language === "en";
  const [readOnly, setReadOnly] = useState(false);
  const [projectId, setProjectId] = useState<string>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [location, setLocation] = useState(
    () => window.location.pathname + window.location.search,
  );
  const [data, setData] = useState<WorkspaceDto>(),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [status, setStatus] = useState(""),
    [source, setSource] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [minRevision, setMinRevision] = useState(""),
    [maxRevision, setMaxRevision] = useState("");
  const [briefDraft, setBriefDraft] = useState<KernelReviewDto>(),
    [leave, setLeave] = useState<LeaveRequest>();
  const [cursor, setCursor] = useState<string>(),
    [refresh, setRefresh] = useState(0);
  const sequence = useRef(0),
    historyPosition = useRef<number>(historyIndex(0)),
    restoringHistory = useRef(false),
    active = useRef(true),
    running = useRef(false),
    focusReturn = useRef<HTMLElement | null>(null);
  const url = new URL(location, window.location.origin),
    route = parseKernelRoute(url.pathname, url.search);
  const primary = ["review", "new", "today"].includes(route.page)
    ? "today"
    : route.page === "search"
      ? "search"
      : route.page === "settings"
        ? "settings"
        : "project";
  function changeLocation(href: string, replace = false) {
    const target = new URL(href, window.location.origin);
    if (
      target.origin !== window.location.origin ||
      !target.pathname.startsWith("/project/")
    )
      return;
    if (replace)
      window.history.replaceState(
        { sestinaPosition: historyPosition.current },
        "",
        href,
      );
    else
      window.history.pushState(
        { sestinaPosition: ++historyPosition.current },
        "",
        href,
      );
    setKind("");
    setStatus("");
    setSource("");
    setQuery("");
    setCursor(undefined);
    setLocation(target.pathname + target.search);
    setError("");
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(".kernel-content h1")?.focus(),
    );
  }
  function guard(proceed: () => void) {
    const detail: LeaveRequest = { proceed };
    const event = new CustomEvent("sestina-before-navigate", {
      cancelable: true,
      detail,
    });
    window.dispatchEvent(event);
    if (event.defaultPrevented) {
      focusReturn.current = document.activeElement as HTMLElement;
      setLeave(detail);
    } else proceed();
  }
  const navigate = (href: string) => {
    guard(() => {
      changeLocation(href);
    });
  };
  useEffect(() => {
    const bridge = desktop();
    return bridge?.onCloseRequested(() => {
      guard(() => {
        void bridge.methods.closeWindow();
      });
    });
  }, []);
  function openReview(r: KernelReviewDto) {
    changeLocation(`/project/reviews/${encodeURIComponent(r.id)}`);
    setRefresh((x) => x + 1);
  }
  async function run(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      if (active.current)
        setError(
          en
            ? "Could not complete this action. Your saved work is kept. Recheck the project and try again."
            : "未能完成操作，已保存的工作仍在。请核对项目后再试。",
        );
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void researchRoomApi
      .kernelSession()
      .then((value) => {
        if (active.current) {
          const id = (value as { projectId: string | null }).projectId;
          if (id) {
            setProjectId(id);
            setReadOnly(value.readOnly === true);
          }
        }
      })
      .catch(() => {
        if (active.current)
          setError(
            en
              ? "The local session is unavailable. Open the project again."
              : "本地会话不可用，请重新打开项目。",
          );
      });
    return () => {
      active.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    if (route.redirect) changeLocation(route.redirect, true);
  }, [location]);
  useEffect(() => {
    window.history.replaceState(
      { sestinaPosition: historyPosition.current },
      "",
      window.location.href,
    );
    const pop = () => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      const target = window.location.pathname + window.location.search;
      const position = historyIndex(historyPosition.current - 1);
      const detail: LeaveRequest = {
        proceed: () => {
          window.history.go(position - historyPosition.current);
        },
      };
      const event = new CustomEvent("sestina-before-navigate", {
        cancelable: true,
        detail,
      });
      window.dispatchEvent(event);
      if (event.defaultPrevented) {
        restoringHistory.current = true;
        window.history.go(historyPosition.current - position);
        focusReturn.current = document.activeElement as HTMLElement;
        setLeave(detail);
        return;
      }
      historyPosition.current = position;
      guard(() => {
        setCursor(undefined);
        setLocation(target);
      });
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
    };
  }, [location]);
  useEffect(() => {
    if (!projectId) return;
    const revision = ++sequence.current;
    setData(undefined);
    setError("");
    const view =
      route.page === "project"
        ? route.id
          ? "object"
          : "project"
        : route.page === "history"
          ? route.kind === "receipt"
            ? "receipt"
            : "history"
          : route.page === "search"
            ? "search"
            : "today";
    const controller = new AbortController();
    void researchRoomApi
      .kernel(
        projectId,
        "workspace",
        {
          query: {
            view,
            limit: 30,
            ...(route.id && ["object", "receipt"].includes(view)
              ? { id: route.id }
              : {}),
            ...(query && route.page === "search" ? { query } : {}),
            ...((kind || route.kind) && ["project", "search"].includes(view)
              ? { kind: kind || route.kind }
              : {}),
            ...(route.page === "history" && route.section
              ? { kind: route.section }
              : {}),
            ...(status && route.page === "search" ? { status } : {}),
            ...(source && route.page === "search" ? { source } : {}),
            ...(route.page === "search"
              ? {
                  ...(from ? { from: new Date(from).toISOString() } : {}),
                  ...(to
                    ? { to: new Date(`${to}T23:59:59.999`).toISOString() }
                    : {}),
                  ...(minRevision ? { minRevision: Number(minRevision) } : {}),
                  ...(maxRevision ? { maxRevision: Number(maxRevision) } : {}),
                }
              : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
        decodeWorkspace,
        controller.signal,
      )
      .then((value) => {
        if (
          active.current &&
          revision === sequence.current &&
          value.projectId === projectId
        )
          setData(value);
      })
      .catch(() => {
        if (
          active.current &&
          revision === sequence.current &&
          !controller.signal.aborted
        )
          setError(
            en
              ? "Current information could not be read. Reload to rebuild the view; saved research is unchanged."
              : "暂时无法读取当前信息。请重新读取以重建视图，已保存的研究内容不会改变。",
          );
      });
    return () => {
      controller.abort();
    };
  }, [
    projectId,
    location,
    query,
    kind,
    status,
    source,
    from,
    to,
    minRevision,
    maxRevision,
    cursor,
    refresh,
  ]);
  useEffect(() => {
    if (!data?.validUntil) return;
    const timer = setTimeout(
      () => {
        setData(undefined);
        setCursor(undefined);
        setRefresh((x) => x + 1);
      },
      Math.min(
        2147483647,
        Math.max(1, Date.parse(data.validUntil) - Date.now()),
      ),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [data?.validUntil]);
  useEffect(() => {
    const invalidate = () => {
      setData(undefined);
      setCursor(undefined);
      setRefresh((x) => x + 1);
    };
    const channel = new BroadcastChannel("sestina-kernel-context");
    channel.onmessage = invalidate;
    window.addEventListener("sestina-kernel-context", invalidate);
    return () => {
      channel.close();
      window.removeEventListener("sestina-kernel-context", invalidate);
    };
  }, []);
  const label = (key: string) => kernelLabel(key, en);
  const rows = (items: WorkspaceEntryDto[]) => (
    <ul className="kernel-review-list task-list">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`}>
          <div>
            <span className="task-kind">
              {label(item.kind)} · {label(item.status)}
            </span>
            <Button
              variant="quiet"
              onClick={() => {
                navigate(item.href);
              }}
            >
              {label(item.title)}
            </Button>
            {item.summary && item.summary !== item.title ? (
              <p>{item.summary}</p>
            ) : null}
            <small>
              {label(item.reason)}
              {item.matchReason
                ? ` · ${en ? "Matched" : "匹配"}: ${label(item.matchReason)}`
                : ""}
            </small>
            <small>
              {label(item.source)} · {en ? "Version" : "版本"} {item.version}
            </small>
          </div>
          <Button
            onClick={() => {
              navigate(item.href);
            }}
          >
            {item.kind === "review"
              ? en
                ? "Continue review"
                : "继续审议"
              : en
                ? "View details"
                : "查看详情"}
          </Button>
        </li>
      ))}
    </ul>
  );
  return (
    <main id="main-content" className="kernel-workspace">
      {!projectId ? (
        <KernelStartCenter
          en={en}
          onBack={() => {
            guard(onBack);
          }}
          onOpened={(id, _path, readonly = false) => {
            setProjectId(id);
            setReadOnly(readonly);
          }}
        />
      ) : (
        <>
          <aside className="kernel-navigation">
            <nav aria-label={en ? "Primary navigation" : "一级导航"}>
              {[
                ["today", "/project/today", "Today / Review", "今日 / 审议"],
                ["project", "/project/state", "Project", "项目"],
                ["search", "/project/search", "Search", "搜索"],
                ["settings", "/project/settings", "Settings", "设置"],
              ].map(([key, href, english, zh]) => (
                <a
                  className="room-link"
                  key={key}
                  href={href}
                  aria-current={primary === key ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(href ?? "/project/today");
                  }}
                >
                  {en ? english : zh}
                </a>
              ))}
            </nav>
            <Button
              variant="quiet"
              onClick={() => {
                guard(
                  () =>
                    void run(async () => {
                      await researchRoomApi.kernelClose();
                      setProjectId(undefined);
                      setData(undefined);
                      changeLocation("/project/today", true);
                    }),
                );
              }}
            >
              {en ? "Switch project" : "切换项目"}
            </Button>
          </aside>
          <div
            className="kernel-content"
            onClick={(event) => {
              const anchor = (event.target as HTMLElement).closest("a[href]");
              if (
                anchor instanceof HTMLAnchorElement &&
                anchor.origin === window.location.origin &&
                anchor.pathname.startsWith("/project/")
              ) {
                event.preventDefault();
                navigate(anchor.pathname + anchor.search);
              }
            }}
          >
            {readOnly && route.page === "new" ? (
              <section>
                <h1>{en ? "Read-only project" : "只读项目"}</h1>
                <p>
                  {en
                    ? "Browse current objects and history. Reopen with write access to edit saved drafts or continue a request."
                    : "可以浏览当前对象和历史。请以可写方式重新打开后编辑草稿或继续请求。"}
                </p>
                <Button
                  onClick={() => {
                    navigate("/project/state");
                  }}
                >
                  {en ? "Browse research objects" : "浏览研究对象"}
                </Button>
                <Button
                  onClick={() => {
                    navigate("/project/history");
                  }}
                >
                  {en ? "Browse history" : "浏览历史"}
                </Button>
              </section>
            ) : route.page === "review" && route.id ? (
              <fieldset disabled={readOnly} className="review-access">
                <legend className="sr-only">
                  {en ? "Review access" : "审议访问"}
                </legend>
                <KernelReviewPanel
                  key={`${projectId}:${route.id}`}
                  projectId={projectId}
                  reviewId={route.id}
                  language={language}
                  onReview={openReview}
                  onChanged={() => {
                    setRefresh((x) => x + 1);
                  }}
                  onEditBrief={(review) => {
                    setBriefDraft(review);
                    changeLocation("/project/state/brief/edit");
                  }}
                />
              </fieldset>
            ) : route.page === "brief" ||
              (route.page === "project" &&
                data?.detail &&
                typeof data.detail === "object" &&
                !Array.isArray(data.detail) &&
                data.detail.kind === "brief") ? (
              <ProjectBriefPanel
                readOnly={readOnly}
                key={`${briefDraft?.id ?? route.section}:${route.id ?? ""}`}
                projectId={projectId}
                language={language}
                onReview={openReview}
                candidate={route.page === "brief" ? briefDraft : undefined}
                initialEditing={route.section === "edit"}
                historyVersionId={
                  route.section === "history" ? route.id : undefined
                }
              />
            ) : route.page === "new" ? (
              <KernelNewReview
                projectId={projectId}
                en={en}
                onReview={openReview}
              />
            ) : route.page === "settings" ? (
              <section>
                <h1 tabIndex={-1}>{en ? "Settings" : "设置"}</h1>
                <nav
                  className="settings-sections"
                  aria-label={en ? "Settings sections" : "设置分区"}
                >
                  {[
                    ["provider", "评估服务", "Provider"],
                    ["privacy", "隐私与网络", "Privacy & network"],
                    [
                      "appearance",
                      "外观与可访问性",
                      "Appearance & accessibility",
                    ],
                    ["recovery", "恢复与数据", "Recovery & data"],
                    ["integrations", "集成", "Integrations"],
                    ["about", "关于", "About"],
                    ["advanced", "技术诊断", "Diagnostics"],
                  ].map(([key, zh, english]) => (
                    <Button
                      key={key}
                      aria-pressed={route.section === key}
                      onClick={() => {
                        navigate(`/project/settings/${key}`);
                      }}
                    >
                      {en ? english : zh}
                    </Button>
                  ))}
                </nav>
                {route.section === "integrations" ? (
                  <KernelConnectionsPanel
                    projectId={projectId}
                    en={en}
                    onReview={openReview}
                  />
                ) : route.section === "privacy" ? (
                  <>
                    <p>
                      {en
                        ? "Only the exact content you select and confirm is sent. An interrupted request is never resent automatically."
                        : "仅发送你本次选择并确认的精确内容。中断的请求不会自动重发。"}
                    </p>
                    <KernelMemoryPanel projectId={projectId} en={en} />
                  </>
                ) : route.section === "appearance" ? (
                  <Button
                    onClick={() => {
                      onSettings("appearance");
                    }}
                  >
                    {en ? "Change appearance and motion" : "调整外观与动效"}
                  </Button>
                ) : route.section === "provider" ? (
                  <>
                    <p>
                      {en
                        ? "Model opinions are optional. You can save research changes without a configured service."
                        : "模型意见可选。没有配置评估服务，也可以保存研究变更。"}
                    </p>
                    <Button
                      onClick={() => {
                        onSettings("provider");
                      }}
                    >
                      {en ? "Configure assessment service" : "配置评估服务"}
                    </Button>
                    <Button
                      onClick={() => {
                        onSettings("second_opinion");
                      }}
                    >
                      {en ? "Configure second opinion" : "配置第二意见"}
                    </Button>
                  </>
                ) : route.section === "recovery" ? (
                  <>
                    <p>
                      {en
                        ? "Saved drafts and results reopen from the local project. Close the project before running recovery."
                        : "已保存的草稿和结果保存在本地项目中。运行恢复前需关闭项目。"}
                    </p>
                    <Button
                      onClick={() => {
                        guard(
                          () =>
                            void run(async () => {
                              await researchRoomApi.kernelClose();
                              setProjectId(undefined);
                            }),
                        );
                      }}
                    >
                      {en ? "Close project for recovery" : "关闭项目并进入恢复"}
                    </Button>
                  </>
                ) : desktop() ? <DesktopAbout en={en} /> : (
                  <>
                    <p>
                      {en
                        ? "Sestina — local research, with decisions made by you."
                        : "Sestina：在本地开展研究，由你作出决定。"}
                    </p>
                    <p>
                      {en
                        ? "This is the controlled browser candidate. The published preview remains v0.2.0; desktop installation belongs to the next stage."
                        : "当前为受控浏览器候选应用。已发布预览仍为 v0.2.0，桌面安装属于下一阶段。"}
                    </p>
                    <details>
                      <summary>{en ? "Technical details" : "技术详情"}</summary>
                      <pre>
                        {data
                          ? JSON.stringify(
                              {
                                projectId: data.projectId,
                                revision: data.sourceProjectStateRevision,
                                inputHash: data.inputHash,
                                policy: data.policyVersion,
                                evaluatedAt: data.evaluatedAt,
                              },
                              null,
                              2,
                            )
                          : en
                            ? "Not available"
                            : "暂不可用"}
                      </pre>
                    </details>
                  </>
                )}
              </section>
            ) : route.page === "not_found" || route.page === "read_only" ? (
              <section>
                <h1 tabIndex={-1}>
                  {route.page === "read_only"
                    ? en
                      ? "This historical workflow is read-only"
                      : "此历史流程只读"
                    : en
                      ? "Page not found"
                      : "未找到此页面"}
                </h1>
                <Button
                  onClick={() => {
                    navigate("/project/today");
                  }}
                >
                  {en ? "Go to Today" : "返回今日"}
                </Button>
              </section>
            ) : (
              <section>
                {readOnly ? (
                  <p role="status">
                    {en
                      ? "Read-only · research writes and model requests are disabled."
                      : "只读浏览：研究写入和模型请求已停用。"}
                  </p>
                ) : null}
                <header className="task-heading">
                  <h1 tabIndex={-1}>
                    {route.page === "today"
                      ? en
                        ? "Today / Review"
                        : "今日 / 审议"
                      : route.page === "project"
                        ? en
                          ? "Project"
                          : "项目"
                        : route.page === "search"
                          ? en
                            ? "Search"
                            : "搜索"
                          : en
                            ? "History"
                            : "历史"}
                  </h1>
                  {route.page === "today" ? (
                    <Button
                      variant="primary"
                      onClick={() => {
                        navigate("/project/reviews/new");
                      }}
                    >
                      {en ? "New review" : "新建审议"}
                    </Button>
                  ) : null}
                </header>
                {route.page === "today" && data ? (
                  <>
                    <div className="today-task">
                      <h2>{en ? "Current research" : "当前研究"}</h2>
                      <p>{data.brief.question}</p>
                      <p>{data.brief.task}</p>
                      <Button
                        onClick={() => {
                          navigate("/project/state/brief");
                        }}
                      >
                        {en ? "Research Brief" : "研究简报"}
                      </Button>
                      <Button
                        onClick={() => {
                          navigate("/project/state/brief/edit");
                        }}
                      >
                        {en ? "Edit Brief" : "修改简报"}
                      </Button>
                    </div>
                    <h2>{en ? "Needs your attention" : "等待你处理"}</h2>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        navigate("/project/history?kind=review");
                      }}
                    >
                      {en ? "Saved reviews" : "已保存审议"}
                    </Button>
                  </>
                ) : null}
                {route.page === "project" ? (
                  <div className="brief-actions">
                    <KernelMemoryDrawer projectId={projectId} en={en} />
                    <Button
                      onClick={() => {
                        setBriefDraft(undefined);
                        navigate("/project/state/brief");
                      }}
                    >
                      {en ? "Research Brief" : "研究简报"}
                    </Button>
                    <Button
                      onClick={() => {
                        navigate("/project/history");
                      }}
                    >
                      {en ? "History" : "历史"}
                    </Button>
                    <Button
                      onClick={() => {
                        navigate("/project/state?context=1");
                      }}
                    >
                      {en ? "Project context" : "项目上下文"}
                    </Button>
                  </div>
                ) : null}
                {route.page === "search" || route.page === "project" ? (
                  <form
                    className="workspace-filters"
                    onSubmit={(e) => {
                      e.preventDefault();
                    }}
                  >
                    {route.page === "search" ? (
                      <label>
                        {en ? "Search research" : "搜索研究内容"}
                        <input
                          type="search"
                          value={query}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            setCursor(undefined);
                          }}
                          maxLength={1024}
                        />
                      </label>
                    ) : null}
                    <label>
                      {en ? "Type" : "类别"}
                      <select
                        value={kind || (route.kind ?? "")}
                        onChange={(e) => {
                          setKind(e.target.value);
                          setCursor(undefined);
                        }}
                      >
                        <option value="">
                          {en ? "All types" : "全部类别"}
                        </option>
                        {[
                          "brief",
                          "decision",
                          "evidence",
                          "issue",
                          "episode",
                          "artifact",
                          "revision",
                          "claim",
                          "mechanism",
                          "claim_evidence_link",
                          "mechanism_evidence_link",
                          "snapshot",
                          "delta",
                          "review",
                          "receipt",
                          "legacy",
                        ].map((k) => (
                          <option key={k} value={k}>
                            {label(k)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {route.page === "search" ? (
                      <>
                        <label>
                          {en ? "State" : "状态"}
                          <select
                            value={status}
                            onChange={(e) => {
                              setStatus(e.target.value);
                              setCursor(undefined);
                            }}
                          >
                            <option value="">
                              {en ? "All states" : "全部状态"}
                            </option>
                            {[
                              "draft",
                              "stale",
                              "provider_attempt_uncertain",
                              "committed",
                              "disposed",
                              "open",
                              "resolved",
                              "waived",
                              "current",
                              "active",
                              "superseded",
                              "saved",
                            ].map((value) => (
                              <option key={value} value={value}>
                                {label(value)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {en ? "Source" : "来源"}
                          <select
                            value={source}
                            onChange={(e) => {
                              setSource(e.target.value);
                              setCursor(undefined);
                            }}
                          >
                            <option value="">
                              {en ? "All sources" : "全部来源"}
                            </option>
                            {[
                              "canonical",
                              "user",
                              "host",
                              "kernel_receipt",
                              "review_correction",
                              "context_only",
                              "research_room_receipts",
                              "deliberation_rooms",
                              "closed_external_app_pilots",
                            ].map((s) => (
                              <option key={s} value={s}>
                                {label(s)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    ) : null}
                  </form>
                ) : null}
                {route.page === "search" ? (
                  <>
                    <details>
                      <summary>
                        {en ? "Time and revision filters" : "时间与修订筛选"}
                      </summary>
                      <div className="workspace-filters">
                        {[
                          [
                            "from",
                            en ? "From date" : "起始日期",
                            from,
                            setFrom,
                          ],
                          ["to", en ? "Through date" : "结束日期", to, setTo],
                          [
                            "min",
                            en ? "First revision" : "起始修订",
                            minRevision,
                            setMinRevision,
                          ],
                          [
                            "max",
                            en ? "Last revision" : "结束修订",
                            maxRevision,
                            setMaxRevision,
                          ],
                        ].map(([key, name, value, update]) => (
                          <label key={key as string}>
                            {name as string}
                            <input
                              type={
                                key === "from" || key === "to"
                                  ? "date"
                                  : "number"
                              }
                              min={0}
                              step={1}
                              value={value as string}
                              onChange={(event) => {
                                (update as (s: string) => void)(
                                  event.target.value,
                                );
                                setCursor(undefined);
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    </details>
                    <p role="status">
                      {data
                        ? en
                          ? `Current results · project revision ${data.sourceProjectStateRevision} · ${data.total} ${data.total === 1 ? "result" : "results"}`
                          : `当前结果 · 项目修订 ${data.sourceProjectStateRevision} · 共 ${data.total} 项`
                        : en
                          ? "Updating search results…"
                          : "正在更新搜索结果…"}
                    </p>
                  </>
                ) : null}{" "}
                {url.searchParams.has("context") ? (
                  <KernelMemoryPanel projectId={projectId} en={en} />
                ) : route.page === "history" &&
                  route.kind &&
                  route.kind !== "receipt" ? (
                  <KernelHistoryPanel
                    projectId={projectId}
                    en={en}
                    onReview={openReview}
                    initialKind={route.kind}
                    recordId={route.id}
                  />
                ) : data?.detail ? (
                  <KernelResultDetail
                    detail={data.detail}
                    en={en}
                    onNavigate={navigate}
                  />
                ) : data ? (
                  <>
                    {route.page === "today"
                      ? ["review", "issue"].map((group) => {
                          const items = data.items.filter(
                            (item) => item.kind === group,
                          );
                          return items.length ? (
                            <section
                              key={group}
                              aria-label={
                                group === "review"
                                  ? en
                                    ? "Reviews awaiting you"
                                    : "待处理审议"
                                  : en
                                    ? "Open research issues"
                                    : "待处理研究问题"
                              }
                            >
                              <h3>
                                {group === "review"
                                  ? en
                                    ? "Reviews awaiting you"
                                    : "待处理审议"
                                  : en
                                    ? "Open research issues"
                                    : "待处理研究问题"}
                              </h3>
                              {rows(items)}
                            </section>
                          ) : null;
                        })
                      : rows(data.items)}
                    {!data.items.length ? (
                      <p>
                        {en
                          ? "No items match this view."
                          : "当前没有符合条件的内容。"}
                      </p>
                    ) : null}
                  </>
                ) : !error ? (
                  <p role="status">
                    {en ? "Reading current information…" : "正在读取当前信息…"}
                  </p>
                ) : null}
                {route.page === "today" && data?.recent.length ? (
                  <>
                    <h2>{en ? "Recent saved changes" : "最近保存的修改"}</h2>
                    {rows(data.recent)}
                  </>
                ) : null}
                <div className="brief-actions">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        if (!readOnly) {
                          const report = await researchRoomApi.kernel(
                            projectId,
                            "rebuild_views",
                            {},
                            decodeLocalJson,
                          );
                          if (
                            !Array.isArray(report) ||
                            report.some(
                              (item) =>
                                !item ||
                                typeof item !== "object" ||
                                Array.isArray(item) ||
                                !("ok" in item) ||
                                item.ok !== true,
                            )
                          )
                            throw new Error("rebuild_incomplete");
                        }
                        setCursor(undefined);
                        setRefresh((x) => x + 1);
                      });
                    }}
                  >
                    {en ? "Reload and rebuild view" : "重新读取并重建视图"}
                  </Button>
                  <Button
                    disabled={!data?.nextCursor || busy}
                    onClick={() => {
                      setCursor(data?.nextCursor ?? undefined);
                    }}
                  >
                    {en ? "Next page" : "下一页"}
                  </Button>
                </div>
                {route.page === "history" && !route.id ? (
                  <KernelHistoryPanel
                    projectId={projectId}
                    en={en}
                    onReview={openReview}
                  />
                ) : null}
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
      <Modal
        open={Boolean(leave)}
        title={en ? "Save before leaving?" : "离开前保存修改？"}
        description={
          en
            ? "Unsaved text is held only in this window. Choose what to keep."
            : "未保存的文字只保留在当前窗口。请选择如何处理。"
        }
        closeLabel={en ? "Cancel navigation" : "取消离开"}
        onClose={() => {
          setLeave(undefined);
        }}
        returnFocusRef={focusReturn}
      >
        <div className="brief-actions">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await leave?.save?.();
                const proceed = leave?.proceed;
                setLeave(undefined);
                proceed?.();
              })
            }
          >
            {en ? "Save draft and leave" : "保存草稿并离开"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              leave?.discard?.();
              const proceed = leave?.proceed;
              setLeave(undefined);
              proceed?.();
            }}
          >
            {en ? "Discard changes and leave" : "放弃修改并离开"}
          </Button>
          <Button
            onClick={() => {
              setLeave(undefined);
            }}
          >
            {en ? "Stay here" : "留在此处"}
          </Button>
        </div>
      </Modal>
    </main>
  );
}
