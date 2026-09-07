import { useEffect, useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import { decodeLocalJson, type KernelReviewDto } from "../../api/kernel-dto.js";
import { Button } from "../primitives/Button.js";

interface CorrectionHistory {
  correction: { id: string; publicReason: string; requestedCorrection: string; findingIndex?: number };
  review: KernelReviewDto | null;
  originalAssessment: { publicSummary: string } | null;
  secondAssessment: { publicSummary: string } | null;
  originalProvider?: { model: string; family: string; origin: string } | null;
  secondProvider?: { model: string; family: string; origin: string } | null;
  status: string; runtimeDistinct: boolean; contextIsolated: boolean; comparison: string;
}
export function KernelCorrectionHistory({projectId, review, en, onReview}: {projectId: string; review: KernelReviewDto; en: boolean; onReview: (review: KernelReviewDto) => void}) {
  const [history,setHistory]=useState<CorrectionHistory[]>([]),[error,setError]=useState("");
  useEffect(() => { let live=true; void researchRoomApi.kernel(projectId,"correction_history",{reviewId:review.id},decodeLocalJson).then(value=>{if(live){setHistory(value as unknown as CorrectionHistory[]);setError("");}}).catch(()=>{if(live)setError(en?"Correction history could not be read. Reload the review.":"未能读取纠错历史，请重新读取审议。");}); return ()=>{live=false;}; },[projectId,review.id,review.version]);
  return <>{error?<p role="alert">{error}</p>:null}{history.map(row=><section key={row.correction.id} className="brief-preview">
    <h2>{en?"Correction record":"纠错记录"}</h2><p>{row.correction.publicReason}</p>
    <p>{({withdraw:en?"Requested withdrawal":"希望撤回",qualify:en?"Requested qualification":"希望限定解释",replace:en?"Requested replacement":"希望替换",request_more_context:en?"Requested more context":"希望补充上下文"})[row.correction.requestedCorrection]}</p>
    {row.correction.findingIndex!==undefined?<p>{en?`Original finding ${row.correction.findingIndex+1}`:`原评估第 ${row.correction.findingIndex+1} 条发现`}</p>:null}
    <div className="brief-diff"><div><h3>{en?"Original opinion":"原意见"}</h3><p>{row.originalAssessment?.publicSummary ?? (en?"Body unavailable":"正文不可用")}</p><p>{row.originalProvider?.model}</p></div><div><h3>{en?"Optional second opinion":"可选第二意见"}</h3><p>{row.secondAssessment?.publicSummary ?? (en?"No second opinion saved":"尚未保存第二意见")}</p><p>{row.secondProvider?.model}</p></div></div>
    <p>{row.runtimeDistinct ? en?"The configured runtimes differ.":"已核对两个配置使用不同运行时。" : en?"A distinct second runtime has not been established.":"尚未取得来自不同运行时的第二意见。"} {row.contextIsolated?en?"The second request excluded the original verdict and rationale.":"第二次请求已排除原裁决与理由。":""}</p>
    <p>{en?"Runtime separation does not establish independent judgment. Compare the reasons yourself; neither opinion changes research objects.":"运行时不同不代表判断独立。请自行比较理由，两份意见都不能改变研究对象。"}</p>
    <p role="status">{row.status==="closed"?en?"Closed by a saved user effect. Original assessment retained.":"已通过保存的用户操作结案，原评估保留。":row.status==="cancelled"?en?"The continuation was cancelled; no research effect was committed.":"后续审议已取消，没有提交研究变更。":en?"Correction remains open. Choose and confirm a research action in the continuation review.":"纠错尚未结案，请在后续审议中选择并确认研究操作。"}</p>
    {row.review && row.review.id!==review.id?<Button onClick={()=>{if(row.review)onReview(row.review);}}>{en?"Open continuation review":"打开后续审议"}</Button>:null}
  </section>)}</>;
}
