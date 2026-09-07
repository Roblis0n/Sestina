import { useEffect, useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import { decodeBriefView, decodeLocalJson, type ObjectReferenceDto, type KernelReviewDto } from "../../api/kernel-dto.js";
import { BriefRelationshipPicker } from "./BriefRelationshipPicker.js";
import { kernelLabel } from "./kernel-copy.js";
import { Button } from "../primitives/Button.js";

export function KernelEffectEditor({ projectId, en, busy, kind, initialDraft, onKind, onDirty, onPrepare }: { projectId: string; en: boolean; busy: boolean; kind: string; initialDraft: KernelReviewDto["effectDraft"]; onKind: (kind: string) => void; onDirty: () => void; onPrepare: (payload: Record<string, unknown>) => Promise<void> }) {
  const [mode,setMode]=useState("create"),[statement,setStatement]=useState(""),[reason,setReason]=useState(""),[outcome,setOutcome]=useState("deferred"),[decisionStatus,setDecisionStatus]=useState("deferred");
  const [scope,setScope]=useState("project"),[target,setTarget]=useState<ObjectReferenceDto>(),[artifact,setArtifact]=useState<ObjectReferenceDto>(),[resolution,setResolution]=useState<ObjectReferenceDto>();
  const [evidenceKind,setEvidenceKind]=useState(""),[evidenceState,setEvidenceState]=useState(""),[capacity,setCapacity]=useState(""),[citation,setCitation]=useState(""),[locator,setLocator]=useState("");
  const [issueKind,setIssueKind]=useState(""),[criterion,setCriterion]=useState(""),[concepts,setConcepts]=useState(""),[reopen,setReopen]=useState("");
  const [error,setError]=useState("");
  useEffect(() => {
    const p=initialDraft?.payload;
    if(!p || typeof p !== "object" || Array.isArray(p) || typeof p.kind !== "string" || !["record_only","create_decision","add_evidence","create_or_resolve_issue"].includes(p.kind)) return;
    const str=(v:unknown)=>typeof v === "string"?v:"";
    const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
    const ref=(id:unknown)=>initialDraft.objectVersions?.find(v=>v.id===id);
    const evidence=obj(p.evidence),issue=obj(p.issue),scopeValue=obj(p.scope),provenance=obj(evidence.provenance);
    onKind(p.kind); setMode(str(p.mode)||"create"); setReason(str(p.reason)); setOutcome(str(p.outcome)||"deferred");
    setStatement(str(p.statement)||str(evidence.summary)||str(issue.summary)); setDecisionStatus(str(p.status)||"deferred");
    setScope(str(scopeValue.kind)||"project"); setTarget(ref(p.targetId??scopeValue.artifactId??scopeValue.issueId));
    setArtifact(ref(evidence.artifactId??issue.sourceArtifactId)); setResolution(ref(p.resolutionEvidenceId));
    setEvidenceKind(str(evidence.kind)); setEvidenceState(str(evidence.state)); setCapacity(str(evidence.inferenceCapacity)); setCitation(str(provenance.citation)); setLocator(str(provenance.locator));
    setIssueKind(str(issue.kind)); setCriterion(str(issue.violatedCriterion)); setConcepts(Array.isArray(issue.rationaleConcepts)?issue.rationaleConcepts.filter(v=>typeof v==="string").join(", "):"");
    setReopen(Array.isArray(p.reopenConditions)?p.reopenConditions.filter(v=>typeof v==="string").join("\n"):"");
  }, []);
  const picker=(objectKind:ObjectReferenceDto["kind"],selected:ObjectReferenceDto|undefined,change:(ref:ObjectReferenceDto|undefined)=>void,purpose:"reference"|"transition"="reference")=><BriefRelationshipPicker projectId={projectId} kind={objectKind} language={en?"en":"zh-CN"} purpose={purpose} selected={selected?[selected]:[]} onSelect={ref=>{change(ref);onDirty();}} onRemove={()=>{change(undefined);onDirty();}}/>;
  async function prepare() {
    setError("");
    if(!reason.trim()){setError(en?"Add a reason for this change.":"请填写这次修改的理由。");return;}
    try {
      let payload:Record<string,unknown>;
      if(kind==="record_only") payload={kind,outcome,reason};
      else if(kind==="create_decision"&&mode==="transition") {
        if(!target){setError(en?"Choose the decision to change.":"请选择要改变的决定。");return;}
        payload={kind,mode,targetId:target.id,expectedVersion:target.version,status:decisionStatus,reason};
      } else if(kind==="create_or_resolve_issue"&&mode==="resolve") {
        if(!target||!resolution){setError(en?"Choose an issue and the evidence for its resolution.":"请选择问题及支持解决的证据。");return;}
        payload={kind,mode,targetId:target.id,expectedVersion:target.version,resolutionEvidenceId:resolution.id,reason};
      } else {
        if(!statement.trim()){setError(en?"Describe the result to save.":"请填写要保存的具体内容。");return;}
        let anchor:{artifactId:string;revisionId:string;contentHash:string;lineageRootRevisionId:string}|undefined;
        if(kind==="create_or_resolve_issue"||kind==="add_evidence"&&evidenceKind==="artifact_span") {
          if(!artifact){setError(en?"Choose the source artifact.":"请选择来源产物。");return;}
          anchor=await researchRoomApi.kernel(projectId,"artifact_context",{objectRef:{id:artifact.id,version:artifact.version}},decodeLocalJson) as unknown as NonNullable<typeof anchor>;
        }
        if(kind==="create_decision") {
          let decisionScope:Record<string,unknown>={kind:scope};
          if(scope==="artifact"||scope==="issue") {
            if(!target){setError(en?"Choose the object this decision applies to.":"请选择决定适用的对象。");return;}
            decisionScope={kind:scope,[scope==="artifact"?"artifactId":"issueId"]:target.id};
          } else if(scope==="brief") {
            const brief=await researchRoomApi.kernel(projectId,"brief",{},decodeBriefView);
            if(!brief.active){setError(en?"Create a Brief before selecting its scope.":"先保存简报，再选择简报范围。");return;}
            decisionScope={kind:scope,briefVersionId:brief.active.id};
          }
          payload={kind,mode:"create",statement,rationale:reason,scope:decisionScope,reopenConditions:reopen.split("\n").map(s=>s.trim()).filter(Boolean),reason};
        } else if(kind==="add_evidence") {
          if(!evidenceKind||!evidenceState||!capacity||!citation.trim()){setError(en?"Choose the evidence type, status and inference range, and describe its source.":"请选择证据类别、状态和推断范围，并填写来源说明。");return;}
          payload={kind,evidence:{kind:evidenceKind,summary:statement,state:evidenceState,inferenceCapacity:capacity,provenance:{citation,...(locator.trim()?{locator}: {})},...(anchor?{artifactId:anchor.artifactId,revisionId:anchor.revisionId,contentVersionHash:anchor.contentHash}:{})},links:[],reason};
        } else {
          if(!anchor||!issueKind||!criterion.trim()||!concepts.trim()){setError(en?"Choose an issue type and describe the unmet criterion and related concepts.":"请选择问题类别，并填写未满足的标准及相关概念。");return;}
          payload={kind:"create_or_resolve_issue",mode:"create",issue:{kind:issueKind,summary:statement,target:{kind:"artifact",artifactId:anchor.artifactId},violatedCriterion:criterion,rationaleConcepts:concepts.split(/[，,\n]/).map(s=>s.trim()).filter(Boolean),sourceArtifactId:anchor.artifactId,sourceRevisionId:anchor.revisionId,sourceRevisionContentHash:anchor.contentHash,lineageRootRevisionId:anchor.lineageRootRevisionId},reason};
        }
      }
      await onPrepare(payload);
    } catch { setError(en?"Could not prepare this change. Check the selected objects and current versions; your input is kept.":"未能准备修改，请核对所选对象和当前版本。已保留输入。"); }
  }
  return <div onChange={onDirty}>
    {error?<p role="alert">{error}</p>:null}
    <label>{en?"Research action":"研究操作"}<select value={kind} onChange={event=>{onKind(event.target.value);setMode("create");setTarget(undefined);setError("");}}>{[["record_only","仅记录处置","Record a disposition"],["create_decision","保存决定","Save a decision"],["add_evidence","保存证据","Save evidence"],["create_or_resolve_issue","创建或解决问题","Create or resolve an issue"]].map(([value,zh,english])=><option key={value} value={value}>{en?english:zh}</option>)}</select></label>
    {kind==="record_only"?<label>{en?"Disposition":"处置"}<select value={outcome} onChange={e=>{setOutcome(e.target.value);}}>{[["rejected","拒绝","Reject"],["deferred","暂缓","Defer"],["reference_only","仅作参考","Reference only"],["assessment_disputed","不同意评估","Dispute assessment"]].map(([v,zh,english])=><option key={v} value={v}>{en?english:zh}</option>)}</select></label>:null}
    {kind==="create_decision"||kind==="create_or_resolve_issue"?<label>{en?"Operation":"处理方式"}<select value={mode} onChange={e=>{setMode(e.target.value);setTarget(undefined);}}><option value="create">{en?"Create a new object":"创建新对象"}</option><option value={kind==="create_decision"?"transition":"resolve"}>{kind==="create_decision"?en?"Change an existing decision":"改变已有决定":en?"Resolve an existing issue":"解决已有问题"}</option></select></label>:null}
    {mode==="transition"&&kind==="create_decision"?<>{picker("decision",target,setTarget,"transition")}<label>{en?"New decision status":"决定的新状态"}<select value={decisionStatus} onChange={e=>{setDecisionStatus(e.target.value);}}>{[["accepted","接受","Accept"],["frozen","固定","Freeze"],["rejected","拒绝","Reject"],["deferred","暂缓","Defer"]].map(([v,zh,english])=><option key={v} value={v}>{en?english:zh}</option>)}</select></label></>:null}
    {mode==="resolve"&&kind==="create_or_resolve_issue"?<><h3>{en?"Issue to resolve":"要解决的问题"}</h3>{picker("issue",target,setTarget)}<h3>{en?"Resolution evidence":"解决依据"}</h3>{picker("evidence",resolution,setResolution)}</>:null}
    {kind!=="record_only"&&!(kind==="create_decision"&&mode==="transition")&&!(kind==="create_or_resolve_issue"&&mode==="resolve")?<label>{en?"Specific result":"具体内容"}<textarea value={statement} onChange={e=>{setStatement(e.target.value);}} maxLength={8192}/></label>:null}
    {kind==="create_decision"&&mode==="create"?<><label>{en?"Applies to":"适用范围"}<select value={scope} onChange={e=>{setScope(e.target.value);setTarget(undefined);}}>{[["project","整个项目","Whole project"],["brief","当前简报","Current Brief"],["artifact","指定产物","Selected artifact"],["issue","指定问题","Selected issue"]].map(([v,zh,english])=><option value={v} key={v}>{en?english:zh}</option>)}</select></label>{scope==="artifact"||scope==="issue"?picker(scope,target,setTarget):null}<label>{en?"When should this decision be revisited? (optional, one per line)":"何时重新考虑这项决定（可选，每行一项）"}<textarea value={reopen} onChange={e=>{setReopen(e.target.value);}}/></label></>:null}
    {kind==="add_evidence"?<><label>{en?"Evidence type":"证据类别"}<select value={evidenceKind} onChange={e=>{setEvidenceKind(e.target.value);}}><option value="">{en?"Choose a type":"选择类别"}</option>{["artifact_span","interview_excerpt","coded_material","quantitative_result","policy_text","literature_source","user_decision","system_check"].map(v=><option key={v} value={v}>{kernelLabel(v,en)}</option>)}</select></label><label>{en?"Evidence status":"证据状态"}<select value={evidenceState} onChange={e=>{setEvidenceState(e.target.value);}}><option value="">{en?"Choose a status":"选择状态"}</option>{["current","stale","disputed"].map(v=><option key={v} value={v}>{kernelLabel(v,en)}</option>)}</select></label><label>{en?"Inference range":"推断范围"}<select value={capacity} onChange={e=>{setCapacity(e.target.value);}}><option value="">{en?"Choose the supported range":"选择可支持的范围"}</option>{["background_only","descriptive","interpretive","associational","mechanistic","causal","normative","completion"].map(v=><option key={v} value={v}>{kernelLabel(v,en)}</option>)}</select></label><label>{en?"Source citation":"来源说明"}<textarea value={citation} onChange={e=>{setCitation(e.target.value);}}/></label><label>{en?"Location within source (optional)":"来源中的位置（可选）"}<input value={locator} onChange={e=>{setLocator(e.target.value);}}/></label>{evidenceKind==="artifact_span"?picker("artifact",artifact,setArtifact):null}<p>{en?"Saving Evidence records the source and your stated inference range. It does not prove a claim or create a support relationship.":"保存证据会记录来源和你指定的推断范围，不会自动证明主张或创建支持关系。"}</p></>:null}
    {kind==="create_or_resolve_issue"&&mode==="create"?<><label>{en?"Issue type":"问题类别"}<select value={issueKind} onChange={e=>{setIssueKind(e.target.value);}}><option value="">{en?"Choose a type":"选择类别"}</option>{[["target_substitution","目标被替换","Target substitution"],["repeated_audit","重复审查","Repeated audit"],["argument_leap","论证跳跃","Argument leap"],["pseudo_depth","缺少实质内容","No substantive depth"],["evidence_boundary","证据边界","Evidence boundary"],["scope_violation","超出范围","Scope violation"],["decision_violation","违背决定","Decision violation"],["factual_error","事实错误","Factual error"],["methodological","方法问题","Methodological issue"]].map(([v,zh,english])=><option value={v} key={v}>{en?english:zh}</option>)}</select></label><label>{en?"Unmet criterion":"未满足的标准"}<textarea value={criterion} onChange={e=>{setCriterion(e.target.value);}}/></label><label>{en?"Related concepts (separated by commas)":"相关概念（用逗号分隔）"}<input value={concepts} onChange={e=>{setConcepts(e.target.value);}}/></label><h3>{en?"Source artifact":"来源产物"}</h3>{picker("artifact",artifact,setArtifact)}</>:null}
    <label>{en?"Reason":"理由"}<textarea value={reason} onChange={e=>{setReason(e.target.value);}} maxLength={8192}/></label><Button disabled={busy} onClick={()=>{void prepare();}}>{en?"View changes":"查看修改"}</Button>
  </div>;
}
