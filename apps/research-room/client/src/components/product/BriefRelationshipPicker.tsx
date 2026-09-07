import { useEffect, useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import {
  decodeLocalJson,
  type ObjectReferenceDto,
  type RelationshipPageDto,
} from "../../api/kernel-dto.js";
import { kernelLabel, readableKernelValue } from "./kernel-copy.js";
import { Button } from "../primitives/Button.js";

export function BriefRelationshipPicker({
  projectId,
  kind,
  language,
  selected,
  onSelect,
  onRemove,
  purpose = "reference",
}: {
  projectId: string;
  kind: ObjectReferenceDto["kind"];
  language: string;
  selected: readonly ObjectReferenceDto[];
  onSelect: (ref: ObjectReferenceDto) => void;
  onRemove: (ref: ObjectReferenceDto) => void;
  purpose?: "reference" | "transition";
}) {
  const en = language === "en";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<RelationshipPageDto>();
  const [reload, setReload] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError(false);
    void researchRoomApi
      .kernel(
        projectId,
        "relationships",
        { query: { kind, purpose, search, limit: 20, ...(cursor ? { cursor } : {}) } },
        (value) => {
          const p = decodeLocalJson(value) as unknown as RelationshipPageDto;
          if (
            !Array.isArray(p.items) ||
            p.items.some(
              (i) =>
                typeof i.name !== "string" ||
                typeof i.id !== "string" ||
                !Number.isSafeInteger(i.version),
            )
          )
            throw new Error("invalid_payload");
          return p;
        },
      )
      .then((p) => {
        if (current) setPage(p);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [projectId, kind, search, cursor, reload, purpose]);
  return (
    <div className="brief-picker" aria-busy={busy}>
      <label>
        {en ? "Search current project" : "搜索当前项目"}
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCursor(undefined);
          }}
        />
      </label>
      {error ? (
        <p role="alert">
          {en
            ? "The project changed. Search again."
            : "项目已变化，请重新搜索。"}
          <Button
            onClick={() => {
              setCursor(undefined);
              setSearch("");
              setReload((n) => n + 1);
            }}
          >
            {en ? "Reload" : "重新加载"}
          </Button>
        </p>
      ) : null}
      {busy ? (
        <p role="status">{en ? "Loading objects…" : "正在读取对象…"}</p>
      ) : null}
      {!busy && !error && !page?.items.length ? (
        <p>{en ? "No matching objects." : "没有匹配的对象。"}</p>
      ) : null}
      <ul className="brief-picker-list">
        {page?.items.map((item) => {
          const checked = selected.some((r) => r.id === item.id);
          return (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy || (!item.selectable && !checked)}
                  onChange={() => {
                    if (checked) onRemove(item);
                    else onSelect({
                          kind: item.kind,
                          id: item.id,
                          version: item.version,
                        });
                  }}
                />
                <span>
                  {item.name}
                  <small>
                    {kernelLabel(item.status, en)} · {en ? "Version" : "版本"}{" "}
                    {item.version}
                  </small>
                  {item.source !== null ? <small>{readableKernelValue(item.source,en)}</small> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="brief-actions">
        <Button
          disabled={!cursor || busy}
          onClick={() => {
            setCursor(undefined);
          }}
        >
          {en ? "First page" : "回到首页"}
        </Button>
        <Button
          disabled={!page?.nextCursor || busy}
          onClick={() => {
            setCursor(page?.nextCursor ?? undefined);
          }}
        >
          {en ? "Next page" : "下一页"}
        </Button>
      </div>
      <p>
        {en ? `${selected.length} selected` : `已选择 ${selected.length} 项`}
      </p>
    </div>
  );
}
