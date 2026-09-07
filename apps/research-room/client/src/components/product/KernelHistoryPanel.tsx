import { useEffect, useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import {
  decodeLocalJson,
  decodeReview,
  type KernelReviewDto,
  type LocalJson,
} from "../../api/kernel-dto.js";
import { readableKernelValue } from "./kernel-copy.js";
import { Button } from "../primitives/Button.js";

interface Historical {
  sourceKind: string;
  sourceId: string;
  classification: string;
  legacyPayload: LocalJson;
  projection: LocalJson;
  children?: LocalJson[];
}
export function KernelHistoryPanel({
  projectId,
  en,
  onReview,
}: {
  projectId: string;
  en: boolean;
  onReview: (review: KernelReviewDto) => void;
}) {
  const [kind, setKind] = useState("research_room_receipts"),
    [items, setItems] = useState<Historical[]>([]),
    [cursor, setCursor] = useState<string>();
  const [suggestion, setSuggestion] = useState(""),
    [selected, setSelected] = useState<string>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(next?: string) {
    setBusy(true);
    setError("");
    try {
      const page = (await researchRoomApi.kernel(
        projectId,
        "legacy_history",
        { sourceKind: kind, limit: 20, ...(next ? { cursor: next } : {}) },
        decodeLocalJson,
      )) as unknown as { items: Historical[]; nextCursor?: string };
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch {
      setError(
        en ? "Historical records could not be read." : "未能读取历史记录。 ",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setSelected(undefined);
    setSuggestion("");
    void load();
  }, [kind, projectId]);
  return (
    <section>
      <h1>{en ? "Historical workflows" : "历史流程"}</h1>
      <p>
        {en
          ? "These records are read-only. Past accepted labels do not prove a research change occurred. Continuing creates a new draft; nothing is resumed or sent automatically."
          : "这些记录只读。旧记录中的接受标签不能证明研究对象已改变。继续工作会创建新草稿，不会恢复旧流程或自动外发。"}
      </p>
      <label>
        {en ? "Record type" : "记录类别"}
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
          }}
        >
          {[
            ["research_room_receipts", "旧审议", "Previous reviews"],
            ["correction_appeals", "旧纠错", "Previous corrections"],
            ["deliberation_rooms", "旧审议室", "Previous deliberation rooms"],
            ["closed_external_app_pilots", "旧试运行", "Previous pilots"],
          ].map(([v, zh, english]) => (
            <option key={v} value={v}>
              {en ? english : zh}
            </option>
          ))}
        </select>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {busy ? (
        <p role="status">{en ? "Loading history…" : "正在读取历史…"}</p>
      ) : null}
      {!items.length && !busy && !error ? (
        <p>{en ? "No records of this type." : "没有这类历史记录。"}</p>
      ) : null}
      {items.map((item, i) => (
        <article key={item.sourceId}>
          <h2>
            {en ? "Historical record" : "历史记录"} {i + 1}
          </h2>
          <pre>{readableKernelValue(item.legacyPayload, en)}</pre>
          {item.children?.length ? <details><summary>{en ? "Attempts, failures and events" : "尝试、失败与事件"} ({item.children.length})</summary>{item.children.map((child,index)=><pre key={index}>{readableKernelValue(child,en)}</pre>)}</details> : null}
          <Button onClick={() => { const url=URL.createObjectURL(new Blob([JSON.stringify(item,null,2)],{type:"application/json"})); const link=document.createElement("a"); link.href=url; link.download="sestina-historical-record.json"; link.click(); setTimeout(()=>{URL.revokeObjectURL(url);},1000); }}>{en ? "Export this historical record" : "导出这条历史记录"}</Button>
          <details>
            <summary>{en ? "Compatibility details" : "兼容详情"}</summary>
            <pre>{JSON.stringify(item.projection, null, 2)}</pre>
          </details>
          <Button
            disabled={busy}
            onClick={() => {
              setSelected(item.sourceId);
              setSuggestion("");
            }}
          >
            {en ? "Continue in a new draft" : "通过新草稿继续"}
          </Button>
        </article>
      ))}
      {selected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            void researchRoomApi
              .kernel(
                projectId,
                "convert_legacy",
                { sourceKind: kind, sourceId: selected, suggestion },
                decodeReview,
              )
              .then(onReview)
              .catch(() => {
                setError(
                  en
                    ? "Draft was not created. If already converted, reopen the saved draft."
                    : "未能创建草稿。如果此前已转换，请打开已保存草稿。 ",
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <label>
            {en ? "What should be reviewed now?" : "这次需要审议什么"}
            <textarea
              value={suggestion}
              onChange={(e) => {
                setSuggestion(e.target.value);
              }}
              maxLength={65536}
            />
          </label>
          <Button type="submit" disabled={busy || !suggestion.trim()}>
            {en ? "Create linked draft" : "创建关联草稿"}
          </Button>
        </form>
      ) : null}
      <div className="brief-actions">
        <Button disabled={busy} onClick={() => void load()}>
          {en ? "Reload first page" : "重新读取首页"}
        </Button>
        <Button disabled={busy || !cursor} onClick={() => void load(cursor)}>
          {en ? "Next page" : "下一页"}
        </Button>
      </div>
    </section>
  );
}
