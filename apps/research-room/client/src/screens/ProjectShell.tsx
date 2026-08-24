import { useState } from "react";
import type {
  AnalyzedReviewDto,
  AppLanguage,
  EvidenceClass,
  PreparedReviewDto,
  ResearchRoomReceiptDto,
  ResearchRoomStateDto,
} from "../api/dto.js";
import { Button } from "../components/primitives/Button.js";
import { StatusBadge } from "../components/primitives/StatusBadge.js";
import { ContextInspector, type InspectorSelection } from "../components/product/ContextInspector.js";
import { ReceiptList } from "../components/product/ReceiptList.js";
import { ReviewWorkspace } from "../components/product/ReviewWorkspace.js";
import { t } from "../i18n/copy.js";

interface ProjectShellProps {
  readonly language: AppLanguage;
  readonly state: ResearchRoomStateDto;
  readonly busy: boolean;
  readonly prepared?: PreparedReviewDto;
  readonly analyzed?: AnalyzedReviewDto;
  readonly inspectorOpen: boolean;
  readonly inspectorSelection?: InspectorSelection;
  readonly onInspector: (open: boolean, selection?: InspectorSelection) => void;
  readonly onSwitchProject: () => void;
  readonly onPrepared: (prepared?: PreparedReviewDto) => void;
  readonly onAnalyzed: (analyzed?: AnalyzedReviewDto) => void;
  readonly onPrepare: (suggestion: string, evidenceClass: EvidenceClass) => Promise<PreparedReviewDto>;
  readonly onAnalyze: (prepared: PreparedReviewDto, signal: AbortSignal) => Promise<AnalyzedReviewDto>;
  readonly onCancel: (prepared: PreparedReviewDto) => Promise<void>;
  readonly onCommit: ReviewWorkspaceParameters["onCommit"];
  readonly onCommitted: (receipt: ResearchRoomReceiptDto) => Promise<void>;
  readonly onDownload: (receipt: ResearchRoomReceiptDto) => Promise<void>;
  readonly onRollback: (receipt: ResearchRoomReceiptDto, reason: string) => Promise<void>;
  readonly onRuntime: ReviewWorkspaceParameters["onRuntime"];
  readonly onNotice: ReviewWorkspaceParameters["onNotice"];
}

type ReviewWorkspaceParameters = Parameters<typeof ReviewWorkspace>[0];

export function ProjectShell(props: ProjectShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  function inspect(selection: InspectorSelection) { props.onInspector(true, selection); }
  return <main id="main-content" className="project-shell" data-navigation-collapsed={collapsed} data-inspector-open={props.inspectorOpen}>
    <aside className="project-navigation" aria-label="Project navigation">
      <div className="project-navigation__header"><span className="project-monogram" aria-hidden="true">{props.state.project.title.slice(0, 1).toUpperCase()}</span><div><small>{t(props.language, "project")}</small><strong>{props.state.project.title}</strong></div><Button type="button" variant="quiet" aria-label={t(props.language, collapsed ? "expand_navigation" : "collapse_navigation")} onClick={() => { setCollapsed((value) => !value); }}>{collapsed ? "→" : "←"}</Button></div>
      <nav><p className="nav-label">ROOMS</p><button type="button" className="room-link" aria-current="page"><span aria-hidden="true">◎</span><span><strong>{t(props.language, "review_room")}</strong><small>{props.language === "en" ? "Active review workflow" : "当前审议流程"}</small></span></button></nav>
      <section className="brief-summary" aria-labelledby="sidebar-brief"><p className="nav-label" id="sidebar-brief">{t(props.language, "current_brief")}</p><dl><dt>{t(props.language, "research_question")}</dt><dd>{props.state.brief.projectQuestion}</dd><dt>{t(props.language, "current_task")}</dt><dd>{props.state.brief.currentTask}</dd></dl><StatusBadge tone="neutral">{props.state.brief.currentStage}</StatusBadge></section>
      <div className="project-navigation__footer"><Button type="button" variant="quiet" onClick={props.onSwitchProject}>{t(props.language, "switch_project")}</Button></div>
    </aside>
    <div className="project-workspace">
      <ReviewWorkspace language={props.language} projectId={props.state.project.id} busy={props.busy} prepared={props.prepared} analyzed={props.analyzed} onPrepared={props.onPrepared} onAnalyzed={props.onAnalyzed} onPrepare={props.onPrepare} onAnalyze={props.onAnalyze} onCancel={props.onCancel} onCommit={props.onCommit} onCommitted={props.onCommitted} onInspect={inspect} onRuntime={props.onRuntime} onNotice={props.onNotice} />
      <ReceiptList language={props.language} receipts={props.state.receipts} busy={props.busy} onInspect={(receipt) => { inspect({ kind: "receipt", value: receipt }); }} onDownload={props.onDownload} onRollback={props.onRollback} onError={(message) => { props.onNotice(message, "danger"); }} />
    </div>
    <ContextInspector language={props.language} open={props.inspectorOpen} selection={props.inspectorSelection} onClose={() => { props.onInspector(false); }} />
  </main>;
}
