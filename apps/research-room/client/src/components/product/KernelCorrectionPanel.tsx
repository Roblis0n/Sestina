import { useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import {
  decodeLocalJson,
  type KernelReviewDto,
  type KernelReviewViewDto,
} from "../../api/kernel-dto.js";
import { Button } from "../primitives/Button.js";

export function KernelCorrectionPanel({
  projectId,
  view,
  en,
  onReview,
}: {
  projectId: string;
  view: KernelReviewViewDto;
  en: boolean;
  onReview: (review: KernelReviewDto) => void;
}) {
  const [selected, setSelected] = useState("");
  const [action, setAction] = useState("qualify");
  const [reason, setReason] = useState("");
  const [finding, setFinding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = view.attempts.find((a) => a.id === selected);
  const eligible = view.attempts.filter(
    (a) => a.status === "completed" && a.assessmentHash,
  );
  if (!eligible.length) return null;
  return (
    <details>
      <summary>{en ? "Dispute an assessment" : "纠正或质疑评估"}</summary>
      <p>
        {en
          ? "The original assessment stays in history. A new review records your correction. A second opinion is optional and requires a separate runtime and a new send confirmation."
          : "原评估保留在历史中。你的纠正会保存为新的审议。第二意见可选，需要不同运行时，并重新核对和确认发送内容。"}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        {en ? "Original assessment" : "原评估"}
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setFinding("");
          }}
        >
          <option value="">{en ? "Choose an assessment" : "选择评估"}</option>
          {eligible.map((a) => (
            <option key={a.id} value={a.id}>
              {en ? "Attempt" : "尝试"} {a.ordinal}:{" "}
              {a.assessment?.publicSummary}
            </option>
          ))}
        </select>
      </label>
      {attempt?.assessment?.envelope?.assessment?.findings.length ? (
        <label>
          {en ? "Scope of correction" : "纠正范围"}
          <select
            value={finding}
            onChange={(e) => {
              setFinding(e.target.value);
            }}
          >
            <option value="">{en ? "Whole assessment" : "整份评估"}</option>
            {attempt.assessment.envelope.assessment.findings.map((f, i) => (
              <option key={i} value={i}>
                {f.publicRationale}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        {en ? "Requested correction" : "希望如何纠正"}
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
          }}
        >
          {[
            ["withdraw", "撤回判断", "Withdraw judgment"],
            ["qualify", "限制判断范围", "Qualify judgment"],
            ["replace", "替换判断", "Replace judgment"],
            ["request_more_context", "需要更多上下文", "Request more context"],
          ].map(([v, zh, english]) => (
            <option key={v} value={v}>
              {en ? english : zh}
            </option>
          ))}
        </select>
      </label>
      <label>
        {en ? "Your reason" : "你的理由"}
        <textarea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
          maxLength={8192}
        />
      </label>
      <Button
        disabled={busy || !attempt || !reason.trim()}
        onClick={() => {
          if (!attempt) return;
          setBusy(true);
          setError("");
          void researchRoomApi
            .kernel(
              projectId,
              "append_correction",
              {
                reviewId: view.review.id,
                expectedVersion: view.review.version,
                attemptId: attempt.id,
                originalAssessmentHash: attempt.assessmentHash,
                requestedCorrection: action,
                ...(finding ? { findingIndex: Number(finding) } : {}),
                reason,
              },
              decodeLocalJson,
            )
            .then((result) => {
              onReview(
                (result as unknown as { review: KernelReviewDto }).review,
              );
            })
            .catch(() => {
              setError(
                en
                  ? "Correction was not saved. Reload the original assessment and check again."
                  : "纠正未保存，请重新读取原评估后核对。 ",
              );
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {en ? "Save correction draft" : "保存纠正草稿"}
      </Button>
    </details>
  );
}
