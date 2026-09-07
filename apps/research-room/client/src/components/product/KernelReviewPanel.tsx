import { requireLocalValue } from "../../api/kernel-dto.js";
import { KernelCorrectionHistory } from "./KernelCorrectionHistory.js";
import { KernelMemoryDrawer } from "./KernelMemoryDrawer.js";
import { useEffect, useState } from "react";
import { researchRoomApi, ResearchRoomApiError } from "../../api/client.js";
import {
  decodeLocalJson,
  decodeReviewView,
  decodeReview,
  type KernelReviewViewDto,
  type KernelReviewDto,
  type LocalJson,
  type ObjectReferenceDto,
} from "../../api/kernel-dto.js";
import { kernelLabel, readableKernelValue, visibleKernelChanges } from "./kernel-copy.js";
import { KernelEffectEditor } from "./KernelEffectEditor.js";
import { KernelCorrectionPanel } from "./KernelCorrectionPanel.js";
import { BriefRelationshipPicker } from "./BriefRelationshipPicker.js";
import type { MemoryItemDto } from "./KernelMemoryPanel.js";
import { Button } from "../primitives/Button.js";

const statusLabels: Record<string, [string, string]> = {
  draft: ["草稿已保存", "Draft saved"],
  manifest_prepared: ["待核对发送内容", "Check send content"],
  manifest_confirmed: ["内容已确认", "Content confirmed"],
  provider_attempt_prepared: ["尚未发送", "Not sent yet"],
  provider_attempt_running: ["请求已开始", "Request started"],
  provider_attempt_failed: ["评估未完成", "Assessment failed"],
  provider_attempt_uncertain: ["外发结果不确定", "Send outcome uncertain"],
  assessment_recorded: ["评估已保存", "Assessment saved"],
  stale: ["需要重新核对", "Recheck required"],
  committed: ["研究变更已保存", "Research change saved"],
  disposed: [
    "处置已保存，研究对象未改变",
    "Disposition saved; research objects unchanged",
  ],
  cancelled: ["已取消", "Cancelled"],
};
export function KernelReviewPanel({
  projectId,
  reviewId,
  language,
  onChanged,
  onReview,
  onEditBrief,
}: {
  projectId: string;
  reviewId: string;
  language: string;
  onChanged: () => void;
  onReview: (review: KernelReviewDto) => void;
  onEditBrief: (review: KernelReviewDto) => void;
}) {
  const en = language === "en";
  const [view, setView] = useState<KernelReviewViewDto>();
  const [body, setBody] = useState<LocalJson>();
  const [suggestion, setSuggestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<LocalJson>();
  const [draftInputsChanged, setDraftInputsChanged] = useState(false);
  const [attemptPending, setAttemptPending] = useState(false);
  const [memoryCandidates, setMemoryCandidates] = useState<{ item: MemoryItemDto; sendEligible: boolean }[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<{ id: string; version: number; contentHash: string }[]>([]);
  const [evidence, setEvidence] = useState<ObjectReferenceDto[]>([]);
  const [issues, setIssues] = useState<ObjectReferenceDto[]>([]);
  const [coverage, setCoverage] = useState<{ section: string; status: string }[]>([]);
  const [kind, setKind] = useState("record_only");
  const load = async () => {
    const v = await researchRoomApi.kernel(
      projectId,
      "read",
      { reviewId },
      decodeReviewView,
    );
    setView(v);
    setSuggestion(v.review.suggestion);
    if (v.review.terminalOutcome?.receiptId && v.review.effectDraft) {
      setReceipt(await researchRoomApi.kernel(projectId, "lookup", {
        authorityCommandId: v.review.effectDraft.authorityCommandId,
      }, decodeLocalJson));
    }
    return v;
  };
  useEffect(() => {
    setReceipt(undefined);
    setBody(undefined);
    setConfirmed(false);
    void load().then(v => {
      const payload=v.review.effectDraft?.payload;
      if(payload && typeof payload === "object" && !Array.isArray(payload) && typeof payload.kind === "string") setKind(payload.kind);
    }).catch(() => {
      setError(en ? "Could not load this review." : "未能读取这条审议。");
    });
  }, [reviewId, projectId]);
  useEffect(() => {
    const refresh = () => { setBody(undefined); setConfirmed(false); setSelectedMemory([]); setMemoryCandidates([]); void load().catch(() => { setView(undefined); setError(en ? "Reload the review to inspect current content." : "请重新读取审议，查看当前内容。"); }); };
    const channel = new BroadcastChannel("sestina-kernel-context");
    channel.onmessage = refresh;
    window.addEventListener("sestina-kernel-context", refresh);
    window.addEventListener("focus", refresh);
    return () => { channel.close(); window.removeEventListener("sestina-kernel-context", refresh); window.removeEventListener("focus", refresh); };
  }, [projectId, reviewId]);
  useEffect(() => {
    if (!attemptPending) return;
    const timer = setInterval(() => { void load().catch(() => { setError(en ? "The request state could not be refreshed. Reload before trying again." : "暂时无法读取请求状态，请重新读取后再操作。"); }); }, 750);
    return () => { clearInterval(timer); };
  }, [attemptPending, reviewId, projectId]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      onChanged();
    } catch (failure) {
      const codes = failure instanceof ResearchRoomApiError ? [failure.code, ...failure.reasons] : [];
      setError(
        codes.some(code => ["provider_unavailable", "second_opinion_not_configured"].includes(code))
          ? en ? "No assessment provider is configured for this review. You can continue without assessment." : "本条审议尚未配置评估服务，可以跳过评估继续处理。"
          : codes.includes("second_opinion_same_runtime")
          ? en ? "The second opinion uses the same runtime. Choose a different service or continue without assessment." : "第二意见使用了同一个服务运行配置。请选择不同服务，或跳过评估继续处理。"
          : codes.includes("provider_generation_changed")
          ? en ? "The provider configuration changed. No new connection was opened. Prepare and confirm the current send content again." : "评估服务配置已变化，本次未建立网络连接。请重新准备并确认当前发送内容。"
          : codes.some(code => ["stale_revision", "stale_object"].includes(code))
          ? en ? "The project or target object changed. Your draft is kept. Compare current versions and confirm a new preview." : "项目或目标对象已变化，草稿已保留。请比较当前版本，并重新确认新预览。"
          : en
          ? "The action did not complete. Your work is kept. Recheck the current version or look up the saved result."
          : "操作未完成，已保留你的工作。请核对当前版本，或查询已保存的结果。",
      );
      await load().catch(() => { setView(undefined); });
    } finally {
      setBusy(false);
      setConfirmed(false);
    }
  };
  if (!view)
    return (
      <p role="status">{error || (en ? "Loading review…" : "正在读取审议…")}</p>
    );
  const r = view.review,
    next = view.allowedNext,
    stale = view.staleReasons.length > 0 || r.status === "stale";
  const command = (action: string, extra: Record<string, unknown> = {}) =>
    researchRoomApi.kernel(
      projectId,
      action,
      { reviewId, expectedVersion: r.version, ...extra },
      decodeLocalJson,
    );
  const preview = r.effectDraft?.preview as
    | {
        objectLabels?: Record<string,string>; affectedReviews?: LocalJson[]; affectedManifests?: LocalJson[];
        objects?: { kind: string; version: number; before: LocalJson; after: LocalJson }[];
        unchangedObjects?: LocalJson[];
        rollbackMode?: string;
      }
    | undefined;
  async function prepare() {
    await command("prepare_manifest", {
      selection: { coverageScope: { effectKind: kind, targetKinds: [...new Set([...evidence, ...issues].map(ref => ref.kind))] }, memory: selectedMemory, evidenceIds: evidence.map(item => item.id), issueIds: issues.map(item => item.id) },
      useProvider: true,
    });
    await load();
    setBody(
      await researchRoomApi.kernel(
        projectId,
        "manifest",
        { reviewId },
        decodeLocalJson,
      ),
    );
  }
  const manifest = (body ?? view.manifest) as
    | {
        identityHash?: string;
        exactRequestBody?: string | null;
        exactRequestBytes?: number;
        bodyRedaction?: { redactionId: string };
        contextSelection?: {briefCoverage?: {section:string; status:string; reason:string}[]};
      }
    | undefined;
  return (
    <section className="kernel-review-panel" aria-busy={busy}>
      <header>
        <h1>{en ? "Review suggestion" : "审议建议"}</h1>
        <p role="status">{statusLabels[r.status]?.[en ? 1 : 0] ?? r.status}</p>
        <small>
          {en ? "Version" : "版本"} {r.version} ·{" "}
          {en ? "Project revision" : "项目修订"} {view.projectStateRevision}
        </small>
      </header>
      <KernelMemoryDrawer projectId={projectId} en={en}/>
      {!r.terminalOutcome ? <label>{en ? "Focus of a new assessment" : "新评估关注的操作"}<select value={kind} disabled={busy} onChange={event=>{setKind(event.target.value);setConfirmed(false);}}>{[["record_only","仅记录处置","Record a disposition"],["create_decision","保存决定","Save a decision"],["add_evidence","保存证据","Save evidence"],["create_or_resolve_issue","创建或解决问题","Create or resolve an issue"],["patch_brief","修改简报","Update the Brief"],["formal_direction_change","改变研究方向","Change research direction"]].map(([value,zh,english])=><option key={value} value={value}>{en?english:zh}</option>)}</select></label> : null}
      {error ? (
        <p role="alert" className="persistent-message">
          {error}
        </p>
      ) : null}
      {stale ? (
        <p className="persistent-message">
          {en
            ? "The project changed. Recheck the context and prepare a new preview."
            : "项目已变化，请重新核对上下文并生成预览。"}
        </p>
      ) : null}
      <label>
        {en ? "Suggestion" : "建议内容"}
        <textarea
          value={suggestion}
          readOnly={!next.includes("edit")}
          onChange={(e) => {
            setSuggestion(e.target.value);
          }}
        />
      </label>
      {next.includes("edit") ? (
        <Button
          disabled={busy || !suggestion.trim()}
          onClick={() =>
            void run(async () => {
              await command("edit", { suggestion });
            })
          }
        >
          {en ? "Save draft" : "保存草稿"}
        </Button>
      ) : null}
      {next.some((a) =>
        ["prepare_manifest", "rebuild_manifest", "skip_assessment"].includes(a),
      ) ? (
        <div className="brief-actions">
          <Button disabled={busy} onClick={() => void run(prepare)}>
            {en ? "View send content" : "查看发送内容"}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await command("skip_assessment", { selection: { coverageScope: { effectKind: kind, targetKinds: [...new Set([...evidence, ...issues].map(ref => ref.kind))] }, memory: selectedMemory, evidenceIds: evidence.map(ref => ref.id), issueIds: issues.map(ref => ref.id) } });
                setBody(undefined);
              })
            }
          >
            {en ? "Continue without assessment" : "跳过评估，继续处理"}
          </Button>
        </div>
      ) : null}
      {next.some(action => ["prepare_manifest", "rebuild_manifest", "skip_assessment"].includes(action)) ? <details><summary>{en ? "Choose context for a new assessment" : "选择新评估的上下文"}</summary>
        <p>{en ? "Choose only what this request needs. Memory starts unselected and remains separate from Evidence." : "只选择本次请求需要的内容。Memory 默认不选，与证据分开。"}</p>
        <details><summary>{en ? "Evidence" : "证据"}</summary><BriefRelationshipPicker projectId={projectId} kind="evidence" language={language} selected={evidence} onSelect={ref => {setEvidence(old=>[...old.filter(v=>v.id!==ref.id),ref]);setBody(undefined);setConfirmed(false);}} onRemove={ref=>{setEvidence(old=>old.filter(v=>v.id!==ref.id));setBody(undefined);setConfirmed(false);}}/></details>
        <details><summary>{en ? "Issues" : "问题"}</summary><BriefRelationshipPicker projectId={projectId} kind="issue" language={language} selected={issues} onSelect={ref => {setIssues(old=>[...old.filter(v=>v.id!==ref.id),ref]);setBody(undefined);setConfirmed(false);}} onRemove={ref=>{setIssues(old=>old.filter(v=>v.id!==ref.id));setBody(undefined);setConfirmed(false);}}/></details>
        <Button disabled={busy} onClick={()=>void run(async()=>{setSelectedMemory([]);setBody(undefined);setMemoryCandidates(await researchRoomApi.kernel(projectId,"recall_memory",{trigger:"add_context",objectIds:[]},decodeLocalJson) as unknown as typeof memoryCandidates);})}>{en ? "Look up project context" : "查找项目上下文"}</Button>
        {memoryCandidates.map(row=><label key={row.item.id}><input type="checkbox" checked={selectedMemory.some(ref=>ref.id===row.item.id)} disabled={!row.sendEligible||busy} onChange={event=>{const checked=event.target.checked;setSelectedMemory(old=>checked&&row.item.contentHash?[...old.filter(ref=>ref.id!==row.item.id),{id:row.item.id,version:row.item.version,contentHash:row.item.contentHash}]:old.filter(ref=>ref.id!==row.item.id));setBody(undefined);setConfirmed(false);}}/><span>{readableKernelValue(row.item.content??null,en)}{!row.sendEligible?<small>{en?"This item cannot be sent.":"此项禁止发送。"}</small>:null}</span></label>)}
        <p>{en?`${selectedMemory.length} context items selected.`:`已选择 ${selectedMemory.length} 项上下文。`}</p>
        <Button disabled={busy} onClick={()=>void run(async()=>{setCoverage(await researchRoomApi.kernel(projectId,"coverage",{reviewId,effectKind:kind,targetKinds:[...new Set([...evidence,...issues].map(ref=>ref.kind))]},decodeLocalJson) as unknown as typeof coverage);})}>{en?"Check Brief coverage for this action":"检查简报对本次操作的覆盖"}</Button>
        {coverage.length?<><p>{en?"Missing context limits an assessment; it does not remove your right to decide.":"上下文缺失会限制评估，不会取消你的裁决权。"}</p><ul>{coverage.filter(row=>row.status!=="not_applicable").map(row=><li key={row.section}>{kernelLabel(row.section,en)}: {row.status==="limited"?en?"Not provided; assessment limited":"未提供，评估受限":en?"Information supplied":"已提供信息"}</li>)}</ul></>:null}
      </details>:null}
      {r.manifestId ? (
        <details>
          <summary>
            {en ? "Context and send content" : "上下文与发送内容"}
          </summary>
          {manifest?.contextSelection?.briefCoverage ? <ul>{manifest.contextSelection.briefCoverage.filter(row => row.status !== "not_applicable").map(row => <li key={row.section}>{kernelLabel(row.section,en)}：{row.status === "limited" ? en ? "Not provided; assessment limited" : "未提供，评估受限" : en ? "Provided or explicitly left empty" : "已填写或已说明为空"}</li>)}</ul> : null}
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setBody(
                  await researchRoomApi.kernel(
                    projectId,
                    "manifest",
                    { reviewId },
                    decodeLocalJson,
                  ),
                );
              })
            }
          >
            {en ? "Read exact content" : "读取准确内容"}
          </Button>
          {body ? (
            <>
              <p>
                {en ? "Request bytes" : "请求字节数"}:{" "}
                {manifest?.exactRequestBytes ?? 0}
              </p>
              <pre className="exact-request">
                {manifest?.bodyRedaction ? (en ? "The local request body was removed by Forget. The original send proof is retained." : "本地请求正文已按忘记操作移除，原发送证明保留。") : manifest?.exactRequestBody ??
                  (en
                    ? "Local snapshot; nothing will be sent."
                    : "本地快照，不外发内容。")}
              </pre>
            </>
          ) : null}
        </details>
      ) : null}
      {next.includes("confirm_manifest") && manifest?.exactRequestBody ? (
        <div>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
              }}
            />
            {en
              ? "I have checked this exact content."
              : "我已核对以上准确发送内容。"}
          </label>
          <Button
            disabled={busy || !confirmed}
            onClick={() =>
              void run(async () => {
                await command("confirm_manifest", {
                  manifestIdentityHash: manifest.identityHash,
                  confirmed: true,
                });
              })
            }
          >
            {en ? "Confirm content" : "确认内容"}
          </Button>
        </div>
      ) : null}
      {next.includes("prepare_attempt") ? (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await command("prepare_attempt");
            })
          }
        >
          {en ? "Prepare this request" : "准备本次请求"}
        </Button>
      ) : null}
      {next.includes("start_attempt") ? (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setAttemptPending(true);
              try { await command("start_attempt", {
                manifestIdentityHash: manifest?.identityHash,
                confirmed: true,
              }); } finally { setAttemptPending(false); }
            })
          }
        >
          {en ? "Send this request" : "发送本次请求"}
        </Button>
      ) : null}
      {next.includes("cancel_attempt") ? (
        <Button
          onClick={() =>
            void command("cancel_attempt")
              .then(load)
              .catch(() => {
                setError(
                  en
                    ? "Cancellation outcome is uncertain. Reload to check."
                    : "取消结果不确定，请重新读取状态。",
                );
              })
          }
        >
          {en ? "Cancel request" : "取消请求"}
        </Button>
      ) : null}
      {view.attempts.map((a) => (
        <article key={a.id}>
          <h2>
            {en ? "Assessment attempt" : "评估尝试"} {a.ordinal}
          </h2>
          <p>{kernelLabel(a.status, en)}</p>
          {a.assessment ? <p>{a.assessment.publicSummary}</p> : null}
        </article>
      ))}
      <KernelCorrectionHistory projectId={projectId} review={r} en={en} onReview={onReview}/>
      <KernelCorrectionPanel
        projectId={projectId}
        view={view}
        en={en}
        onReview={onReview}
      />
      {next.includes("prepare_effect") ? (
        <details open={!r.effectDraft || undefined} onChange={() => { setDraftInputsChanged(true); setConfirmed(false); }}>
          <summary>
            {en ? "Choose the research change" : "选择研究变更"}
          </summary>
          {kind === "patch_brief" || kind === "formal_direction_change" ? <p>{en ? "Use the Research Brief form to prepare this change." : "请在研究简报表单中准备这项修改。"}</p> : <KernelEffectEditor key={reviewId} initialDraft={r.effectDraft} projectId={projectId} en={en} busy={busy} kind={kind} onKind={setKind} onDirty={() => { setDraftInputsChanged(true); setConfirmed(false); }} onPrepare={async payload => { await run(async () => {
            let expectedVersion=r.version;
            const m=view.manifest as {provider?:unknown;contextSelection?:{coverageScope?:{effectKind?:string}}}|null;
            if(!m?.provider && m?.contextSelection?.coverageScope?.effectKind !== payload.kind) {
              const prepared = await command("skip_assessment", {selection:{coverageScope:{effectKind:payload.kind,targetKinds:[]},memory:selectedMemory,evidenceIds:evidence.map(ref=>ref.id),issueIds:issues.map(ref=>ref.id)}});
              expectedVersion=decodeReview(prepared).version;
            }
            await researchRoomApi.kernel(projectId,"prepare_effect",{reviewId,expectedVersion,payload},decodeLocalJson); setDraftInputsChanged(false);
          }); }}/>} 
        </details>
      ) : null}
      {r.effectDraft && ["patch_brief", "formal_direction_change"].includes(String((r.effectDraft.payload as { kind?: string }).kind)) && !["committed", "disposed", "cancelled"].includes(r.status) ? <Button disabled={busy} onClick={() => { onEditBrief(r); }}>{en ? "Edit this Brief draft" : "继续编辑这份简报草稿"}</Button> : null}
      {r.effectDraft && !r.effectDraft.invalidated && !draftInputsChanged ? (
        <section className="brief-preview">
          <h2>{r.terminalOutcome ? en ? "Saved changes" : "已保存的修改" : en ? "Changes to confirm" : "待确认的修改"}</h2>
          {preview?.objects?.map((o, i) => (
            <article key={i}>
              <h3>{kernelLabel(o.kind, en)} · {en ? "Version" : "版本"} {o.version}</h3>
              {visibleKernelChanges(o.before,o.after).map(change => <section key={change.field}><h4>{kernelLabel(change.field,en)}</h4><div className="brief-diff"><div><strong>{en?"Before":"修改前"}</strong><pre>{readableKernelValue(change.before,en,preview.objectLabels)}</pre></div><div><strong>{en?"After":"修改后"}</strong><pre>{readableKernelValue(change.after,en,preview.objectLabels)}</pre></div></div></section>)}
            </article>
          ))}
          {preview?.objects?.length === 0 ? (
            <p>
              {en ? "No research objects will change." : "本次不改变研究对象。"}
            </p>
          ) : null}
          <details><summary>{en ? "Object bindings and technical details" : "对象绑定与技术详情"}</summary><pre>{JSON.stringify(r.effectDraft.preview,null,2)}</pre></details>
          <p>
            {en
              ? `${preview?.unchangedObjects?.length ?? 0} other objects stay unchanged.`
              : `其他 ${preview?.unchangedObjects?.length ?? 0} 个对象保持不变。`}
          </p>
          {preview?.affectedReviews?.length ? <p>{en?`${preview.affectedReviews.length} pending reviews and ${preview.affectedManifests?.length??0} context confirmations will need rechecking.`:`${preview.affectedReviews.length} 条待处理审议与 ${preview.affectedManifests?.length??0} 份上下文确认需要重新核对。`}</p>:null}
          <p>
            {en
              ? "Later corrections use a new review and a new revision."
              : "后续纠正通过新的审议和修订完成。"}
          </p>
          {next.includes("commit") && !stale ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                  }}
                />
                {en
                  ? "I confirm the changes shown above."
                  : "我确认以上具体修改。"}
              </label>
              <Button
                variant="primary"
                disabled={busy || !confirmed}
                onClick={() =>
                  void run(async () => {
                    setReceipt(
                      await command("commit", {
                        previewHash: requireLocalValue(r.effectDraft).previewHash,
                        authorityCommandId: requireLocalValue(r.effectDraft).authorityCommandId,
                        confirmed: true,
                      }),
                    );
                  })
                }
              >
                {en ? "Confirm and save" : "确认并保存"}
              </Button>
            </>
          ) : null}
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const found = await researchRoomApi.kernel(
                  projectId,
                  "lookup",
                  { authorityCommandId: requireLocalValue(r.effectDraft).authorityCommandId },
                  decodeLocalJson,
                );
                setReceipt(found);
                if (found === null)
                  setError(
                    en
                      ? "No saved result for this command yet. Recheck before submitting."
                      : "尚未找到这次命令的保存结果，请重新核对后再提交。",
                  );
              })
            }
          >
            {en ? "Find saved result" : "查询保存结果"}
          </Button>
        </section>
      ) : null}
      {receipt || r.terminalOutcome?.receiptId ? (
        <section>
          <h2>{en ? "Saved result" : "保存结果"}</h2>
          <ul>{r.terminalOutcome?.resultingObjects.map(ref=><li key={ref.id}>{kernelLabel(ref.kind,en)} · {en ? "Version" : "版本"} {ref.version}</li>)}</ul>
          {r.terminalOutcome?.resultingObjects.length === 0 ? <p>{en ? "The disposition is saved. No research object changed." : "处置已保存，研究对象未改变。"}</p> : null}
          <details>
            <summary>{en ? "Receipt details" : "凭证详情"}</summary>
            <pre>{JSON.stringify(receipt, null, 2)}</pre>
          </details>
        </section>
      ) : null}
      {next.includes("cancel") ? (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await command("cancel");
            })
          }
        >
          {en ? "Cancel review" : "取消本次审议"}
        </Button>
      ) : null}
      {r.status === "provider_attempt_uncertain" ? <p className="persistent-message">{en ? "The request may have reached the provider, but its outcome could not be saved with certainty. Reloading will not send it again. You can continue without assessment, or check and confirm a new request." : "请求可能已送达评估服务，但无法确定并保存结果。重新加载不会再次发送。你可以跳过评估继续处理，也可以核对并确认一次新请求。"}</p> : null}
      {next.includes("continue_review") ? <Button disabled={busy} onClick={() => void run(async () => {
        const child = await researchRoomApi.kernel(projectId, "create", {
          suggestion: r.suggestion, sourceReviewId: r.id,
        }, decodeReview);
        onReview(child);
      })}>{en ? "Continue in a new review" : "在新审议中继续"}</Button> : null}
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await load();
          })
        }
      >
        {en ? "Reload state" : "重新读取状态"}
      </Button>
    </section>
  );
}
