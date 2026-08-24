import { useEffect, useRef } from "react";
import type { AnalyzedReviewDto, AppLanguage, PreparedReviewDto, ResearchRoomReceiptDto } from "../../api/dto.js";
import { t } from "../../i18n/copy.js";
import { Button } from "../primitives/Button.js";
import { StatusBadge } from "../primitives/StatusBadge.js";

export type InspectorSelection =
  | { readonly kind: "manifest"; readonly value: PreparedReviewDto }
  | { readonly kind: "analysis"; readonly value: AnalyzedReviewDto }
  | { readonly kind: "receipt"; readonly value: ResearchRoomReceiptDto }
  | { readonly kind: "error"; readonly title: string; readonly message: string; readonly recovery: string };

interface ContextInspectorProps {
  readonly language: AppLanguage;
  readonly open: boolean;
  readonly selection?: InspectorSelection;
  readonly onClose: () => void;
}

export function ContextInspector({ language, open, selection, onClose }: ContextInspectorProps) {
  const rootRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      const prior = priorFocusRef.current;
      if (prior?.isConnected && prior !== document.body && !prior.matches(":disabled")) prior.focus();
      else document.querySelector<HTMLElement>("[data-inspector-return]")?.focus();
    };
  }, [open]);

  function keyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(rootRef.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => !element.hasAttribute("disabled"));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return (
    <>
      <button className="inspector-backdrop" type="button" aria-label={t(language, "close_inspector")} tabIndex={open ? 0 : -1} onClick={onClose} data-open={open} />
      <aside ref={rootRef} className="context-inspector" data-open={open} aria-hidden={!open} aria-label={t(language, "inspector")} onKeyDown={keyDown}>
        <header className="context-inspector__header">
          <div><p className="eyebrow">INSPECTOR</p><h2>{t(language, "inspector")}</h2></div>
          <Button ref={closeRef} type="button" variant="quiet" onClick={onClose} aria-label={t(language, "close_inspector")}>×</Button>
        </header>
        <div className="context-inspector__body">
          {!selection ? <p className="empty-state">{language === "en" ? "Select a Manifest, assessment, Finding, or receipt." : "请选择 Manifest、assessment、Finding 或凭证。"}</p> : null}
          {selection?.kind === "manifest" ? <ManifestInspector language={language} prepared={selection.value} /> : null}
          {selection?.kind === "analysis" ? <AnalysisInspector language={language} analyzed={selection.value} /> : null}
          {selection?.kind === "receipt" ? <ReceiptInspector language={language} receipt={selection.value} /> : null}
          {selection?.kind === "error" ? <section><StatusBadge tone="danger">{selection.title}</StatusBadge><p>{selection.message}</p><h3>{language === "en" ? "Recovery" : "恢复"}</h3><p>{selection.recovery}</p></section> : null}
        </div>
      </aside>
    </>
  );
}

function ManifestInspector({ language, prepared }: { readonly language: AppLanguage; readonly prepared: PreparedReviewDto }) {
  const manifest = prepared.manifest;
  const judge = manifest.semanticJudge;
  return <>
    <StatusBadge tone="warning">{t(language, "manifest_unsent")}</StatusBadge>
    <dl className="inspector-list">
      <dt>Manifest hash</dt><dd><code>{prepared.manifestHash}</code></dd>
      <dt>{t(language, "provider_model")}</dt><dd>{judge ? `${judge.provider.id} / ${judge.provider.model} · ${judge.provider.locality}` : t(language, "ledger_only")}</dd>
      <dt>Network</dt><dd>{manifest.networkRequired ? "required after confirmation" : "not required"} · {manifest.networkUsed ? "used" : "not used"}</dd>
      {judge ? <><dt>Protocol</dt><dd>{judge.protocol.version}<br/><code>{judge.protocol.hash}</code></dd><dt>Prompt</dt><dd>{judge.prompt.version}<br/><code>{judge.prompt.hash}</code></dd><dt>Rubric</dt><dd>{judge.rubric.version}<br/><code>{judge.rubric.hash}</code></dd><dt>Request bytes</dt><dd>{judge.request.requestBodyBytes}</dd></> : null}
    </dl>
    <h3>{t(language, "included")}</h3>
    <ul>{manifest.fields.map((field, index) => <li key={`${field.category}-${index}`}><strong>{field.category}</strong><span>{field.source} · {field.sensitivity}</span></li>)}</ul>
    <h3>{t(language, "excluded")}</h3>
    <p>{judge && judge.excludedFields.length > 0 ? judge.excludedFields.join(" · ") : t(language, "none")}</p>
    {judge ? <details><summary>{t(language, "exact_request")}</summary><pre>{judge.request.requestBody}</pre></details> : null}
  </>;
}

function AnalysisInspector({ language, analyzed }: { readonly language: AppLanguage; readonly analyzed: AnalyzedReviewDto }) {
  return <>
    <StatusBadge tone={analyzed.providerStatus === "semantic_ready" ? "ready" : "warning"}>{analyzed.providerStatus}</StatusBadge>
    {analyzed.ledgerOnlyReason ? <p>{analyzed.ledgerOnlyReason}</p> : null}
    <h3>{t(language, "assessments")}</h3>
    <ol className="assessment-list">{analyzed.semanticJudge?.assessments.map((assessment) => <li key={assessment.criterionId} data-verdict={assessment.verdict}><strong>{assessment.criterionId}</strong><span>{assessment.verdict} · {t(language, "proposal_only")}</span><p>{assessment.publicRationale}</p>{assessment.uncertainty ? <p><b>{t(language, "unknowns")}:</b> {assessment.uncertainty}</p> : null}{assessment.missingContext.length > 0 ? <p><b>{t(language, "missing_context")}:</b> {assessment.missingContext.join(" · ")}</p> : null}{assessment.evidenceSpans.map((span) => <blockquote key={span.quoteHash}>{span.quote} [{span.start}–{span.end}]</blockquote>)}</li>) ?? <li>{t(language, "ledger_only")}</li>}</ol>
    {analyzed.semanticJudge?.findings.length ? <><h3>Semantic Findings · {t(language, "proposal_only")}</h3><ul>{analyzed.semanticJudge.findings.map((finding) => <li key={finding.id}><strong>{finding.kind}</strong><span>{finding.severity} · {finding.authority}</span><p>{finding.rationale}</p><p><b>{language === "en" ? "Minimum recovery" : "最小恢复"}:</b> {finding.minimumRecovery}</p></li>)}</ul></> : null}
    <h3>{t(language, "kernel_findings")}</h3>
    <ul>{analyzed.analysis.findings.map((finding, index) => <li key={`${finding.kind}-${index}`}><strong>{finding.kind}</strong><span>{finding.summary}</span></li>)}</ul>
    <h3>{t(language, "argument_delta")}</h3><p>{analyzed.analysis.argumentDelta.genuineAdditions.join(" · ") || analyzed.analysis.argumentDelta.summary}</p>
    <h3>{t(language, "alternatives")}</h3><p>{analyzed.analysis.alternativeExplanations.join(" · ") || t(language, "none")}</p>
    <h3>{t(language, "unproven")}</h3><p>{analyzed.analysis.unproven.join(" · ") || t(language, "none")}</p>
  </>;
}

function ReceiptInspector({ language, receipt }: { readonly language: AppLanguage; readonly receipt: ResearchRoomReceiptDto }) {
  return <>
    <StatusBadge tone={receipt.status === "committed" ? "ready" : "warning"}>{receipt.status}</StatusBadge>
    <dl className="inspector-list"><dt>ID</dt><dd><code>{receipt.id}</code></dd><dt>Disposition</dt><dd>{receipt.disposition.kind}</dd><dt>Hash</dt><dd><code>{receipt.receiptHash}</code></dd><dt>Semantic Judge</dt><dd>{receipt.semanticJudge ? `${receipt.semanticJudge.assessments.length} assessments` : "ledger_only / legacy receipt"}</dd><dt>Rollback</dt><dd>{receipt.rollback.available ? t(language, "rollback_available") : t(language, "rollback_unavailable")}</dd></dl>
  </>;
}
