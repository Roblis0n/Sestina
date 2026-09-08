import type { LocalJson } from "../../api/kernel-dto.js";
import { kernelLabel, readableKernelValue } from "./kernel-copy.js";
import { Button } from "../primitives/Button.js";
const record = (v: LocalJson): Record<string, LocalJson> =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
const scalar = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
export function KernelResultDetail({
  detail,
  en,
  onNavigate,
}: {
  detail: LocalJson;
  en: boolean;
  onNavigate: (href: string) => void;
}) {
  const item = record(detail),
    isReceipt = typeof item.effectKind === "string",
    data = isReceipt ? item : record(item.data ?? null);
  const fields = isReceipt
    ? ["effectKind", "recordOnlyOutcome", "publicReason"]
    : [
        "title",
        "statement",
        "summary",
        "rationale",
        "status",
        "state",
        "description",
        "inferenceCapacity",
        "reopenConditions",
        "resolution",
      ];
  const refs =
    isReceipt && Array.isArray(item.resultingObjects)
      ? item.resultingObjects
      : [];
  return (
    <article className="workspace-detail">
      <h2>
        {isReceipt
          ? en
            ? "Saved result"
            : "保存结果"
          : kernelLabel(scalar(item.kind ?? "research_object"), en)}
      </h2>
      <p>
        {en ? "Version" : "版本"} {scalar(item.version ?? data.version ?? 1)}
      </p>
      <dl>
        {fields
          .filter((key) => data[key] !== undefined)
          .map((key) => (
            <div key={key}>
              <dt>{kernelLabel(key, en)}</dt>
              <dd>
                <pre>{readableKernelValue(data[key] ?? null, en)}</pre>
              </dd>
            </div>
          ))}
      </dl>
      {isReceipt ? (
        <>
          <p>
            {en ? "Project revision" : "项目修订"}{" "}
            {scalar(item.beforeProjectStateRevision)} →{" "}
            {scalar(item.afterProjectStateRevision)}
          </p>
          {typeof item.reviewId === "string" ? (
            <Button
              onClick={() => {
                onNavigate(
                  `/project/reviews/${encodeURIComponent(scalar(item.reviewId))}`,
                );
              }}
            >
              {en
                ? "View the review behind this result"
                : "查看产生此结果的审议"}
            </Button>
          ) : null}
          {refs.length ? (
            <ul>
              {refs.map((ref, index) => {
                const r = record(ref);
                return (
                  <li key={index}>
                    <Button
                      onClick={() => {
                        onNavigate(
                          `/project/state?object=${encodeURIComponent(scalar(r.id))}`,
                        );
                      }}
                    >
                      {kernelLabel(scalar(r.kind), en)} ·{" "}
                      {en ? "Version" : "版本"} {scalar(r.version)}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>
              {en
                ? "The disposition was saved; no research object changed."
                : "处置已保存，研究对象未改变。"}
            </p>
          )}
        </>
      ) : null}
      {!isReceipt ? (
        <Button
          onClick={() => {
            onNavigate("/project/reviews/new");
          }}
        >
          {en ? "Start a review about this object" : "就此对象发起审议"}
        </Button>
      ) : null}
      {!isReceipt && Array.isArray(item.reviewIds) && item.reviewIds.length ? (
        <section>
          <h2>{en ? "Source reviews" : "来源审议"}</h2>
          {item.reviewIds.map((id) => (
            <p key={scalar(id)}>
              <Button
                onClick={() => {
                  onNavigate(
                    `/project/reviews/${encodeURIComponent(scalar(id))}`,
                  );
                }}
              >
                {en ? "View source review" : "查看来源审议"}
              </Button>
            </p>
          ))}
        </section>
      ) : null}
      {!isReceipt &&
      Array.isArray(item.relatedObjects) &&
      item.relatedObjects.length ? (
        <section>
          <h2>{en ? "Related research objects" : "关联研究对象"}</h2>
          <ul>
            {item.relatedObjects.map((raw) => {
              const ref = record(raw);
              return (
                <li key={scalar(ref.id)}>
                  <Button
                    onClick={() => {
                      onNavigate(scalar(ref.href));
                    }}
                  >
                    {scalar(ref.title)} · {en ? "Version" : "版本"}{" "}
                    {scalar(ref.version)}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <details>
        <summary>{en ? "Full record and proof" : "完整记录与证明"}</summary>
        <pre>{JSON.stringify(detail, null, 2)}</pre>
      </details>
      <Button
        onClick={() => {
          const link = document.createElement("a"),
            url = URL.createObjectURL(
              new Blob([JSON.stringify(detail, null, 2)], {
                type: "application/json",
              }),
            );
          link.href = url;
          link.download = "sestina-record.json";
          link.click();
          setTimeout(() => {
            URL.revokeObjectURL(url);
          }, 1000);
        }}
      >
        {en ? "Export this record" : "导出这条记录"}
      </Button>
    </article>
  );
}
