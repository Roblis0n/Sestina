import { useEffect, useRef, useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import { decodeReview, type KernelReviewDto } from "../../api/kernel-dto.js";
import { Button } from "../primitives/Button.js";
import { KernelConnectionsPanel } from "./KernelConnectionsPanel.js";

export function KernelNewReview({
  projectId,
  en,
  onReview,
}: {
  projectId: string;
  en: boolean;
  onReview: (review: KernelReviewDto) => void;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = useRef(""),
    baseline = useRef(""),
    saved = useRef<KernelReviewDto | undefined>(undefined),
    running = useRef<Promise<KernelReviewDto> | undefined>(undefined),
    saveRef = useRef<(() => Promise<KernelReviewDto>) | undefined>(undefined);
  const active = useRef(true);
  async function save() {
    if (running.current) return running.current;
    const submitted = current.current;
    if (!submitted.trim()) throw new Error("empty_suggestion");
    setBusy(true);
    const operation = researchRoomApi.kernel(
      projectId,
      saved.current ? "edit" : "create",
      saved.current
        ? {
            reviewId: saved.current.id,
            expectedVersion: saved.current.version,
            suggestion: submitted,
          }
        : { suggestion: submitted },
      decodeReview,
    );
    running.current = operation;
    try {
      const result = await operation;
      if (!active.current) throw new Error("session_changed");
      saved.current = result;
      baseline.current = submitted;
      return result;
    } finally {
      running.current = undefined;
      if (active.current) setBusy(false);
    }
  }
  saveRef.current = save;
  useEffect(() => {
    active.current = true;
    const unload = (event: BeforeUnloadEvent) => {
      if (current.current !== baseline.current) event.preventDefault();
    };
    const leave = (event: Event) => {
      if (current.current === baseline.current) return;
      event.preventDefault();
      const detail = (
        event as CustomEvent<{
          save?: () => Promise<void>;
          discard?: () => void;
        }>
      ).detail;
      detail.save = async () => {
        await saveRef.current?.();
        if (current.current !== baseline.current)
          throw new Error("unsaved_draft");
      };
      detail.discard = () => {
        current.current = baseline.current;
        setText(baseline.current);
      };
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("sestina-before-navigate", leave);
    return () => {
      active.current = false;
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("sestina-before-navigate", leave);
    };
  }, []);
  return (
    <section>
      <h1 tabIndex={-1}>{en ? "New review" : "新的审议"}</h1>
      <p>
        {en
          ? "Save a suggestion, then inspect context and choose the change to make."
          : "先保存建议，再核对上下文和希望作出的修改。"}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          void save()
            .then((review) => {
              if (current.current === baseline.current) onReview(review);
              else
                setError(
                  en
                    ? "Draft saved. Your newer text is still unsaved."
                    : "草稿已保存，后来输入的文字尚未保存。",
                );
            })
            .catch(() => {
              setError(
                en
                  ? "Could not save the draft. Your text is kept."
                  : "未能保存草稿，输入已保留。",
              );
            });
        }}
      >
        <label>
          {en ? "New suggestion" : "新的建议"}
          <textarea
            value={text}
            onChange={(event) => {
              current.current = event.target.value;
              setText(event.target.value);
            }}
            maxLength={65536}
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
          {en ? "Save draft" : "保存草稿"}
        </Button>
      </form>
      {error ? <p role="status">{error}</p> : null}
      <KernelConnectionsPanel
        projectId={projectId}
        en={en}
        onReview={onReview}
      />
    </section>
  );
}
