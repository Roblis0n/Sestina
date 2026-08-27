import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { researchRoomApi } from "../api/client.js";
import type {
  AnalyzedReviewDto,
  AppLanguage,
  EvidenceClass,
  PreparedReviewDto,
  ProviderStatusDto,
  ResearchRoomReceiptDto,
  ResearchRoomStateDto,
  ResearchObjectSearchDto,
} from "../api/dto.js";
import { Button } from "../components/primitives/Button.js";
import { StatusBadge } from "../components/primitives/StatusBadge.js";
import { ContextInspector, type InspectorSelection } from "../components/product/ContextInspector.js";
import { ReceiptList } from "../components/product/ReceiptList.js";
import { ReviewWorkspace } from "../components/product/ReviewWorkspace.js";
import { ResearchObjectWorkspace } from "../components/product/ResearchObjectWorkspace.js";
import { CorrectionAppealWorkspace } from "../components/product/CorrectionAppealWorkspace.js";
import { DeliberationRoomWorkspace } from "../components/product/DeliberationRoomWorkspace.js";
import { ProjectMemoryWorkspace } from "../components/product/ProjectMemoryWorkspace.js";
import { t } from "../i18n/copy.js";
import { hrefForRoute, parseProjectRoute, type ProjectRoute } from "../routing/project-route.js";

interface ProjectShellProps {
  readonly language: AppLanguage;
  readonly state: ResearchRoomStateDto;
  readonly busy: boolean;
  readonly provider?: ProviderStatusDto;
  readonly prepared?: PreparedReviewDto;
  readonly analyzed?: AnalyzedReviewDto;
  readonly inspectorOpen: boolean;
  readonly inspectorSelection?: InspectorSelection;
  readonly onInspector: (open: boolean, selection?: InspectorSelection) => void;
  readonly onSwitchProject: () => void;
  readonly onPrepared: (prepared?: PreparedReviewDto) => void;
  readonly onAnalyzed: (analyzed?: AnalyzedReviewDto) => void;
  readonly onPrepare: (suggestion: string, evidenceClass: EvidenceClass, selectedMemoryItemIds: readonly string[]) => Promise<PreparedReviewDto>;
  readonly onAnalyze: (prepared: PreparedReviewDto, signal: AbortSignal) => Promise<AnalyzedReviewDto>;
  readonly onCancel: (prepared: PreparedReviewDto) => Promise<void>;
  readonly onCommit: ReviewWorkspaceParameters["onCommit"];
  readonly onCommitted: (receipt: ResearchRoomReceiptDto) => Promise<void>;
  readonly onDownload: (receipt: ResearchRoomReceiptDto) => Promise<void>;
  readonly onRollback: (receipt: ResearchRoomReceiptDto, reason: string) => Promise<void>;
  readonly onRuntime: ReviewWorkspaceParameters["onRuntime"];
  readonly onNotice: ReviewWorkspaceParameters["onNotice"];
  readonly onError: (error: unknown) => void;
  readonly onAuthorityChanged: () => Promise<void>;
}

type ReviewWorkspaceParameters = Parameters<typeof ReviewWorkspace>[0];

export function ProjectShell(props: ProjectShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [route, setRoute] = useState<ProjectRoute>(() => parseProjectRoute(window.location.pathname));
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState<ResearchObjectSearchDto>();
  const [searching, setSearching] = useState(false);
  const [searchCursor, setSearchCursor] = useState<string>();
  const [searchHistory, setSearchHistory] = useState<(string | undefined)[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const pop = () => { setRoute(parseProjectRoute(window.location.pathname)); clearSearch(); setSearchOpen(false); };
    window.addEventListener("popstate", pop); return () => { window.removeEventListener("popstate", pop); };
  }, []);
  useEffect(() => {
    setSearch(undefined);
    setSearchQuery("");
    setSearchCursor(undefined);
    setSearchHistory([]);
    setSearchOpen(false);
    props.onInspector(false);
  }, [props.state.project.id]);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (!searchOpen) return undefined;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      clearSearch();
      setSearchOpen(false);
      window.requestAnimationFrame(() => { searchTriggerRef.current?.focus(); });
    };
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); };
  }, [searchOpen]);
  function navigate(href: string) { const next = new URL(href, window.location.origin); window.history.pushState({}, "", `${next.pathname}${next.search}`); setRoute(parseProjectRoute(next.pathname)); clearSearch(); setSearchOpen(false); document.getElementById("workspace-heading")?.focus(); }
  async function loadSearch(cursor?: string) {
    if (!searchQuery.trim()) { setSearch(undefined); return; }
    setSearching(true);
    try { setSearch(await researchRoomApi.searchResearchObjects(searchQuery, 50, cursor)); }
    catch (error) { props.onError(error); }
    finally { setSearching(false); }
  }
  async function runSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchCursor(undefined);
    setSearchHistory([]);
    await loadSearch();
  }
  function clearSearch() { setSearch(undefined); setSearchQuery(""); setSearchCursor(undefined); setSearchHistory([]); }
  function closeSearch(returnFocus = false) {
    clearSearch();
    setSearchOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => { searchTriggerRef.current?.focus(); });
  }
  function searchKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeSearch(true);
  }
  function inspect(selection: InspectorSelection) { props.onInspector(true, selection); }
  const nav = [
    { route: { workspace: "overview" } as const, icon: "◫", en: "Overview", zh: "项目概览" },
    { route: { workspace: "brief" } as const, icon: "B", en: "Research Brief", zh: "研究简报" },
    { route: { workspace: "decision" } as const, icon: "D", en: "Decisions", zh: "研究决定" },
    { route: { workspace: "issue" } as const, icon: "I", en: "Issues", zh: "待解决问题" },
    { route: { workspace: "evidence" } as const, icon: "E", en: "Evidence", zh: "研究证据" },
    { route: { workspace: "episode" } as const, icon: "P", en: "Episodes", zh: "研究阶段" },
    { route: { workspace: "receipt" } as const, icon: "R", en: "Receipts", zh: "凭证与轨迹" },
    { route: { workspace: "appeal" } as const, icon: "A", en: "Appeals", zh: "纠错申诉" },
    { route: { workspace: "memory" } as const, icon: "M", en: "Resume / Memory", zh: "恢复与记忆" },
    { route: { workspace: "attention" } as const, icon: "!", en: "Attention", zh: "待处理" },
  ];
  const providerMode = props.provider?.mode === "configured" ? t(props.language, "semantic_ready") : t(props.language, "ledger_only");
  return <main id="main-content" className="project-shell" data-navigation-collapsed={collapsed} data-inspector-open={props.inspectorOpen}>
    <aside className="project-navigation" aria-label={props.language === "en" ? "Project navigation" : "项目导航"}>
      <div className="project-navigation__header"><span className="project-monogram" aria-hidden="true">{props.state.project.title.slice(0, 1).toUpperCase()}</span><div><small>{t(props.language, "project")}</small><strong>{props.state.project.title}</strong></div><Button type="button" variant="quiet" aria-label={t(props.language, collapsed ? "expand_navigation" : "collapse_navigation")} onClick={() => { setCollapsed((value) => !value); }}>{collapsed ? "→" : "←"}</Button></div>
      <nav><p className="nav-label">{props.language === "en" ? "ROOM" : "研究室"}</p><button type="button" className="room-link" aria-current={route.workspace === "review" ? "page" : undefined} data-active={route.workspace === "review"} title={t(props.language, "review_room")} onClick={() => { navigate("/project/review"); }}><span aria-hidden="true">◎</span><span><strong>{t(props.language, "review_room")}</strong><small>{props.language === "en" ? "Active review workflow" : "当前审议流程"}</small></span></button><p className="nav-label nav-label--objects">{props.language === "en" ? "PROJECT OBJECTS" : "项目对象"}</p>{nav.map((item) => <button type="button" className="room-link object-nav-link" key={item.route.workspace} aria-current={route.workspace === item.route.workspace ? "page" : undefined} data-active={route.workspace === item.route.workspace} title={props.language === "en" ? item.en : item.zh} onClick={() => { navigate(hrefForRoute(item.route)); }}><span aria-hidden="true">{item.icon}</span><span><strong>{props.language === "en" ? item.en : item.zh}</strong>{props.language === "zh-CN" ? <small>{item.en}</small> : null}</span></button>)}</nav>
      <section className="brief-summary" aria-labelledby="sidebar-brief"><p className="nav-label" id="sidebar-brief">{t(props.language, "current_brief")}</p><dl><dt>{t(props.language, "research_question")}</dt><dd>{props.state.brief.projectQuestion}</dd><dt>{t(props.language, "current_task")}</dt><dd>{props.state.brief.currentTask}</dd></dl><StatusBadge tone="neutral">{props.state.brief.currentStage}</StatusBadge></section>
      <div className="project-navigation__footer"><Button type="button" variant="quiet" onClick={props.onSwitchProject}>{t(props.language, "switch_project")}</Button></div>
    </aside>
    <div id="workspace-heading" className="project-workspace" tabIndex={-1}>
      <section className="project-context-bar" role="region" aria-label={t(props.language, "current_research_line")}>
        <div className="project-context-bar__line">
          <p className="eyebrow">{t(props.language, "current_research_line")}</p>
          <strong>{props.state.brief.projectQuestion}</strong>
          <p><span>{t(props.language, "current_task")}</span>{props.state.brief.currentTask}</p>
        </div>
        <dl className="project-context-bar__facts"><div><dt>{props.language === "en" ? "Stage" : "阶段"}</dt><dd>{props.state.brief.currentStage}</dd></div><div><dt>Provider</dt><dd>{providerMode}</dd></div></dl>
        <Button ref={searchTriggerRef} type="button" variant="quiet" className="project-search-trigger" aria-expanded={searchOpen} aria-controls="project-search-panel" onClick={() => { if (searchOpen) closeSearch(true); else setSearchOpen(true); }}>{t(props.language, searchOpen ? "close_search" : "search_project")}</Button>
      </section>
      {searchOpen ? <form id="project-search-panel" className="project-search" role="search" aria-label={props.language === "en" ? "Search this project" : "搜索当前项目"} onKeyDown={searchKeyDown} onSubmit={(event) => { void runSearch(event); }}>
        <label htmlFor="project-search-input">{props.language === "en" ? "Project search" : "项目内搜索"}</label>
        <div><input ref={searchInputRef} id="project-search-input" type="search" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); if (!event.target.value) clearSearch(); }} placeholder={props.language === "en" ? "Brief, Decision, Issue, Evidence, Episode, Receipt, Appeal, Deliberation, Memory" : "Brief、Decision、Issue、Evidence、Episode、Receipt、Appeal、会商室、项目记忆"} /><Button type="submit" variant="primary" disabled={searching || !searchQuery.trim()}>{searching ? "…" : props.language === "en" ? "Search" : "搜索"}</Button><Button type="button" variant="quiet" onClick={() => { closeSearch(true); }}>{props.language === "en" ? "Close" : "关闭"}</Button></div>
        {search ? <div className="search-results" role="region" aria-label={props.language === "en" ? "Search results" : "搜索结果"}>{search.items.length ? <ol>{search.items.map((item) => <li key={`${item.kind}-${item.id}`}><button type="button" onClick={() => { navigate(item.href); setSearchQuery(""); }}><strong>{item.title}</strong><span>{item.kind} · {item.status} · {item.source}</span><small>{item.detail}</small></button></li>)}</ol> : <p>{props.language === "en" ? "No structured object matched." : "没有匹配的结构化对象。"}</p>}<nav className="pagination" aria-label={props.language === "en" ? "Search result pages" : "搜索结果分页"}><Button type="button" variant="quiet" disabled={searching || searchHistory.length === 0} onClick={() => { const previous = [...searchHistory]; const prior = previous.pop(); setSearchHistory(previous); setSearchCursor(prior); void loadSearch(prior); }}>{props.language === "en" ? "Previous" : "上一页"}</Button><span>{props.language === "en" ? "Up to 50 project-local results" : "本页最多 50 个项目内结果"}</span><Button type="button" variant="quiet" disabled={searching || !search.nextCursor} onClick={() => { const next = search.nextCursor; if (!next) return; setSearchHistory((current) => [...current, searchCursor]); setSearchCursor(next); void loadSearch(next); }}>{props.language === "en" ? "Next" : "下一页"}</Button></nav>{search.truncated ? <small>{props.language === "en" ? "More stable, navigable matches are available on the next page." : "下一页还有稳定、可导航的匹配结果。"}</small> : null}</div> : null}
      </form> : null}
      {route.workspace === "review" ? <><ReviewWorkspace language={props.language} projectId={props.state.project.id} providerMode={providerMode === t(props.language, "semantic_ready") ? "configured" : "ledger_only"} busy={props.busy} prepared={props.prepared} analyzed={props.analyzed} onPrepared={props.onPrepared} onAnalyzed={props.onAnalyzed} onPrepare={props.onPrepare} onAnalyze={props.onAnalyze} onCancel={props.onCancel} onCommit={props.onCommit} onCommitted={props.onCommitted} onInspect={inspect} onRuntime={props.onRuntime} onNotice={props.onNotice} /><ReceiptList language={props.language} receipts={props.state.receipts} busy={props.busy} onInspect={(receipt) => { inspect({ kind: "receipt", value: receipt }); }} onOpenTrace={(receipt) => { navigate(`/project/receipts/${receipt.id}`); }} onDownload={props.onDownload} onRollback={props.onRollback} onError={(message) => { props.onNotice(message, "danger"); }} /></> : route.workspace === "appeal" ? <CorrectionAppealWorkspace language={props.language} projectId={props.state.project.id} route={route} onNavigate={navigate} onError={props.onError} onNotice={props.onNotice} onAuthorityChanged={props.onAuthorityChanged} /> : route.workspace === "deliberation_room" ? <DeliberationRoomWorkspace language={props.language} projectId={props.state.project.id} route={route} onNavigate={navigate} onInspect={inspect} onError={props.onError} onNotice={props.onNotice} onAuthorityChanged={props.onAuthorityChanged} /> : route.workspace === "memory" ? <ProjectMemoryWorkspace language={props.language} projectId={props.state.project.id} onNavigate={navigate} onInspect={inspect} onError={props.onError} onNotice={props.onNotice} onAuthorityChanged={props.onAuthorityChanged} /> : <ResearchObjectWorkspace language={props.language} projectId={props.state.project.id} route={route} onNavigate={navigate} onInspect={inspect} onError={props.onError} onNotice={props.onNotice} onAuthorityChanged={props.onAuthorityChanged} />}
    </div>
    <ContextInspector language={props.language} open={props.inspectorOpen} selection={props.inspectorSelection} onNavigate={(href) => { props.onInspector(false); navigate(href); }} onClose={() => { props.onInspector(false); }} />
  </main>;
}
