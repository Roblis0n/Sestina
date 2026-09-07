import { requireLocalValue } from "../../api/kernel-dto.js";
import { useEffect, useRef, useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import {
  decodeLocalJson,
  decodeBriefView,
  type LocalJson,
  type ObjectReferenceDto,
} from "../../api/kernel-dto.js";
import { BriefRelationshipPicker } from "./BriefRelationshipPicker.js";
import { readableKernelValue } from "./kernel-copy.js";
import { Button } from "../primitives/Button.js";

export interface MemoryItemDto {
  id: string;
  version: number;
  state: string;
  kind?: string;
  content?: LocalJson;
  contentHash?: string;
  source?: LocalJson;
  retention?: LocalJson;
  sensitivity?: string;
  outboundPolicy?: string;
}
interface MemoryRow {
  item: MemoryItemDto;
  userState: string;
  reason: string;
  recallEligible: boolean;
  sendEligible: boolean;
}
interface CopyPlan {
  planHash: string;
  files: { locationToken: string; contentHash: string }[];
  blocked: string[];
}
export function KernelMemoryPanel({
  projectId,
  en,
  embedded = false,
}: {
  projectId: string;
  en: boolean;
  embedded?: boolean;
}) {
  const [rows, setRows] = useState<MemoryRow[]>([]),
    [revision, setRevision] = useState(0);
  const editor = useRef<HTMLDetailsElement>(null);
  const forgetHeading = useRef<HTMLHeadingElement>(null);
  const [kind, setKind] = useState("working_hint"),
    [text, setText] = useState(""),
    [term, setTerm] = useState("");
  const [refs, setRefs] = useState<ObjectReferenceDto[]>([]),
    [retention, setRetention] = useState("until_unpinned"),
    [date, setDate] = useState("");
  const [sensitivity, setSensitivity] = useState("project_private"),
    [outbound, setOutbound] = useState("never_send"),
    [reason, setReason] = useState("");
  const [editing, setEditing] = useState<MemoryItemDto>(),
    [forget, setForget] = useState<MemoryItemDto>(),
    [forgetConfirmed, setForgetConfirmed] = useState(false);
  useEffect(() => { forgetHeading.current?.focus(); }, [forget?.id]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pendingCommand, setPendingCommand] = useState<string>();
  const [plan, setPlan] = useState<CopyPlan>(),
    [privacy, setPrivacy] = useState<{
      status: string;
      details: { plan: CopyPlan; copyAction?: "delete" | "retire" } | null;
    }>(),
    [cleanupConfirmed, setCleanupConfirmed] = useState(false);
  const [copyAction,setCopyAction]=useState<"delete"|"retire">("delete");
  const [sourceKind, setSourceKind] = useState("direct_user");
  const [sourceRef, setSourceRef] = useState<{kind: string; id: string; version: number}>();
  const [filter, setFilter] = useState(""),
    [page, setPage] = useState(0);
  async function load() {
    const v = (await researchRoomApi.kernel(
      projectId,
      "memory",
      {},
      decodeLocalJson,
    )) as unknown as { projectStateRevision: number; items: MemoryRow[] };
    setRows(v.items);
    setRevision(v.projectStateRevision);
    setPrivacy(
      (await researchRoomApi.kernel(
        projectId,
        "privacy_status",
        {},
        decodeLocalJson,
      )) as unknown as NonNullable<typeof privacy>,
    );
  }
  useEffect(() => {
    void load().catch(() => {
      setError(en ? "Memory could not be loaded." : "未能读取项目上下文。");
    });
    setPendingCommand(sessionStorage.getItem(`kernel-pending-memory:${projectId}`) ?? undefined);
  }, [projectId]);
  useEffect(() => {
    const invalidate = () => {
      setRows([]); setEditing(undefined); setForget(undefined);
      setText(""); setTerm(""); setRefs([]); setReason("");
      void load().catch(() => { setError(en ? "Reload to inspect current context." : "请重新读取当前上下文。"); });
    };
    const channel = new BroadcastChannel("sestina-kernel-context");
    channel.onmessage = invalidate;
    window.addEventListener("sestina-kernel-context", invalidate);
    return () => { channel.close(); window.removeEventListener("sestina-kernel-context", invalidate); };
  }, [projectId]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
    } catch {
      setError(
        en
          ? "The action did not complete. Your input is kept. Reload or find the saved result before retrying."
          : "操作未完成，已保留输入。请重新读取状态或查询保存结果后再试。 ",
      );
      await load().catch(() => { setRows([]); });
    } finally {
      setBusy(false);
    }
  }
  async function govern(input: Record<string, unknown>) {
    const commandId = `memory:${crypto.randomUUID()}`;
    setPendingCommand(commandId);
    sessionStorage.setItem(`kernel-pending-memory:${projectId}`, commandId);
    await researchRoomApi.kernel(
      projectId,
      "govern_memory",
      { commandId, expectedRevision: revision, input },
      decodeLocalJson,
    );
    sessionStorage.removeItem(`kernel-pending-memory:${projectId}`);
    if(editor.current) editor.current.open=false;
    setPendingCommand(undefined);
    const channel = new BroadcastChannel("sestina-kernel-context");
    channel.postMessage({ projectId }); channel.close();
    window.dispatchEvent(new CustomEvent("sestina-kernel-context", { detail: { projectId } }));
    setNotice(en ? "Saved in the project." : "已保存到项目。 ");
  }
  const stateLabel = (state: string) =>
    ({
      suggested: en ? "Suggested" : "建议使用",
      in_use: en ? "In use" : "使用中",
      not_in_use: en ? "Not in use" : "未使用",
      forgotten: en ? "Forgotten" : "已忘记",
    })[state] ?? state;
  const filtered = rows.filter(
    (row) =>
      !filter ||
      readableKernelValue(row.item.content ?? null, en)
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase()),
  );
  function edit(item: MemoryItemDto) {
    setSourceKind("direct_user"); setSourceRef(undefined);
    setEditing(item);
    setKind(item.kind ?? "working_hint");
    const content = item.content as
      | {
          text?: string;
          term?: string;
          definition?: string;
          purpose?: string;
          refs?: ObjectReferenceDto[];
        }
      | undefined;
    setText(content?.text ?? content?.definition ?? content?.purpose ?? "");
    setTerm(content?.term ?? "");
    setRefs(content?.refs ?? []);
    setSensitivity(item.sensitivity ?? "project_private");
    setOutbound(item.outboundPolicy ?? "never_send");
    const r = item.retention as { policy: string; expiresAt?: string };
    setRetention(r.policy);
    setDate(r.expiresAt?.slice(0, 10) ?? "");
    setReason("");
  }
  return (
    <section>
      {embedded ? null : <h1>{en ? "Project context" : "项目上下文"}</h1>}
      {!embedded ? <p>
        {en
          ? "Memory helps you resume work. It is not Evidence. Nothing is recalled or selected for sending automatically."
          : "Memory 帮助你继续工作，不是证据。不会自动召回，也不会自动选入发送内容。"}
      </p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {pendingCommand ? (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await researchRoomApi.kernel(
                projectId,
                "lookup",
                { authorityCommandId: pendingCommand },
                decodeLocalJson,
              );
              if (result) {
                sessionStorage.removeItem(`kernel-pending-memory:${projectId}`);
                setPendingCommand(undefined);
                setNotice(
                  en
                    ? "The original save succeeded."
                    : "已找到原操作的保存结果。 ",
                );
              } else
                setNotice(
                  en
                    ? "No saved result was found. Check the current version before trying again."
                    : "未找到保存结果，请核对当前版本后再试。 ",
                );
            })
          }
        >
          {en ? "Find saved result" : "查询保存结果"}
        </Button>
      ) : null}
      <details ref={editor} open={editing ? true : undefined}>
        <summary>
          {editing
            ? en
              ? "Edit context"
              : "编辑上下文"
            : en
              ? "Add context"
              : "添加上下文"}
        </summary>
        <label>
          {en ? "Type" : "类型"}
          <select
            value={kind}
            disabled={!!editing}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            {[
              ["term", "术语", "Term"],
              ["working_hint", "工作提示", "Working hint"],
              ["resume_note", "接续笔记", "Resume note"],
              ["workset", "工作对象集", "Workset"],
            ].map(([v, zh, english]) => (
              <option value={v} key={v}>
                {en ? english : zh}
              </option>
            ))}
          </select>
        </label>
        {kind === "term" ? (
          <label>
            {en ? "Term" : "术语"}
            <input
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
              }}
            />
          </label>
        ) : null}
        <label>
          {kind === "term"
            ? en
              ? "Definition"
              : "释义"
            : kind === "workset"
              ? en
                ? "Purpose"
                : "用途"
              : en
                ? "Context"
                : "上下文内容"}
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            maxLength={16384}
          />
        </label>
        {kind === "workset"
          ? (["artifact", "decision", "evidence", "issue"] as const).map(
              (k) => (
                <BriefRelationshipPicker
                  key={k}
                  projectId={projectId}
                  kind={k}
                  language={en ? "en" : "zh-CN"}
                  selected={refs.filter((r) => r.kind === k)}
                  onSelect={(ref) => {
                    setRefs((old) => [
                      ...old.filter((r) => r.id !== ref.id),
                      ref,
                    ]);
                  }}
                  onRemove={(ref) => {
                    setRefs((old) => old.filter((r) => r.id !== ref.id));
                  }}
                />
              ),
            )
          : null}
        <label>
          {en ? "Keep until" : "保留期限"}
          <select
            value={retention}
            onChange={(e) => {
              setRetention(e.target.value);
            }}
          >
            <option value="until_unpinned">
              {en ? "I stop using it" : "我主动停用"}
            </option>
            <option value="until_date">
              {en ? "A specified date" : "指定日期"}
            </option>
            {retention === "current_episode" ? (
              <option value="current_episode">
                {en ? "Existing episode ends" : "已有研究轮次结束"}
              </option>
            ) : null}
          </select>
        </label>
        {retention === "until_date" ? (
          <label>
            {en ? "Expiry date" : "到期日期"}
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
              }}
            />
          </label>
        ) : null}
        <label>
          {en ? "Sensitivity" : "敏感程度"}
          <select
            value={sensitivity}
            onChange={(e) => {
              setSensitivity(e.target.value);
              if (e.target.value === "secret_never_send")
                setOutbound("never_send");
            }}
          >
            {[
              ["public", "公开", "Public"],
              ["project_private", "项目私有", "Project private"],
              ["sensitive", "敏感", "Sensitive"],
              ["secret_never_send", "秘密，禁止外发", "Secret, never send"],
            ].map(([v, zh, english]) => (
              <option key={v} value={v}>
                {en ? english : zh}
              </option>
            ))}
          </select>
        </label>
        <label>
          {en ? "Sending policy" : "发送规则"}
          <select
            value={outbound}
            disabled={sensitivity === "secret_never_send"}
            onChange={(e) => {
              setOutbound(e.target.value);
            }}
          >
            <option value="never_send">{en ? "Never send" : "禁止发送"}</option>
            <option value="explicit_manifest_only">
              {en
                ? "Only after explicit selection and confirmation"
                : "仅在明确选择和确认后发送"}
            </option>
          </select>
        </label>
        <details><summary>{en ? "Pin to a project source (optional)" : "固定到项目来源（可选）"}</summary>
          <p>{en ? "A source change makes this context unavailable until you check it and pin it again. Existing source bindings stay in place when editing without a new selection." : "来源变化后，这项上下文停止参与召回；核对后可重新固定来源。编辑时未选择新来源会保留原绑定。"}</p>
          <label>{en ? "Source type" : "来源类别"}<select value={sourceKind} onChange={event => { setSourceKind(event.target.value); setSourceRef(undefined); }}><option value="direct_user">{en ? "No new source selection" : "不选择新来源"}</option>{["brief", "decision", "evidence", "issue", "artifact"].map(kind => <option key={kind} value={kind}>{({brief:en?"Current Brief":"当前简报",decision:en?"Decision":"决定",evidence:en?"Evidence":"证据",issue:en?"Issue":"问题",artifact:en?"Artifact":"产物"})[kind]}</option>)}</select></label>
          {sourceKind === "brief" ? <Button disabled={busy} onClick={() => void run(async () => { const brief = await researchRoomApi.kernel(projectId, "brief", {}, decodeBriefView); if (!brief.brief) throw new Error("brief_missing"); setSourceRef({kind: "brief", id: brief.brief.id, version: brief.brief.version}); })}>{en ? "Use the current Brief as source" : "使用当前简报作为来源"}</Button> : ["decision", "evidence", "issue", "artifact"].includes(sourceKind) ? <BriefRelationshipPicker projectId={projectId} language={en?"en":"zh-CN"} kind={sourceKind as ObjectReferenceDto["kind"]} selected={sourceRef ? [sourceRef as ObjectReferenceDto] : []} onSelect={setSourceRef} onRemove={() => {setSourceRef(undefined);}}/> : null}
          {sourceRef ? <p>{en ? "Source selected; its version will be checked when saving." : "已选择来源，保存时会核对其版本。"}</p> : null}
        </details>
        <label>
          {en ? "Reason" : "理由"}
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            maxLength={4096}
          />
        </label>
        <Button
          disabled={
            busy ||
            !!pendingCommand ||
            (sourceKind !== "direct_user" && !sourceRef) ||
            !text.trim() ||
            !reason.trim() ||
            (kind === "term" && !term.trim()) ||
            (retention === "until_date" && !date)
          }
          onClick={() =>
            void run(async () => {
              const content =
                kind === "term"
                  ? { term, definition: text }
                  : kind === "workset"
                    ? { purpose: text, refs }
                    : { text };
              const retained =
                retention === "until_date"
                  ? {
                      policy: retention,
                      expiresAt: new Date(`${date}T23:59:59Z`).toISOString(),
                    }
                  : retention === "current_episode"
                    ? editing?.retention
                    : { policy: retention };
              const source = sourceRef ? await researchRoomApi.kernel(projectId, "memory_source", { objectRef: sourceRef }, decodeLocalJson) : undefined;
              await govern({
                ...(source ? { source } : {}),
                action: editing ? "edit" : "create",
                ...(editing
                  ? { itemId: editing.id, expectedVersion: editing.version }
                  : { kind }),
                content,
                retention: retained,
                sensitivity,
                outboundPolicy: outbound,
                publicReason: reason,
              });
              setEditing(undefined);
              setText("");
              setTerm("");
              setRefs([]); setSourceRef(undefined); setSourceKind("direct_user");
            })
          }
        >
          {editing
            ? en
              ? "Save edit"
              : "保存修改"
            : en
              ? "Save suggestion"
              : "保存为建议使用"}
        </Button>
        {editing ? <Button disabled={busy || !!pendingCommand || !reason.trim()} onClick={() => void run(async () => {
          const nextRetention = retention === "until_date" ? { policy: retention, expiresAt: new Date(`${date}T23:59:59.999Z`).toISOString() } : retention === "until_unpinned" ? { policy: retention } : editing.retention;
          await govern({ action: "renew", itemId: editing.id, expectedVersion: editing.version, retention: nextRetention, publicReason: reason }); setEditing(undefined);
        })}>{en ? "Renew with this retention and reason" : "按所填期限与理由续期"}</Button> : null}
        {editing ? (
          <Button
            disabled={busy}
            onClick={() => {
              setEditing(undefined);
            }}
          >
            {en ? "Cancel editing" : "取消编辑"}
          </Button>
        ) : null}
      </details>
      <label>
        {en ? "Search context" : "搜索上下文"}
        <input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        />
      </label>
      {!filtered.length ? (
        <p>{en ? "No matching context." : "没有匹配的上下文。"}</p>
      ) : null}
      {filtered.slice(page * 20, (page + 1) * 20).map((row) => (
        <article key={row.item.id}>
          <h2>{stateLabel(row.userState)}</h2>
          {row.item.state === "forgotten" ? (
            <p>
              {en
                ? "The content was removed. A record of your choice remains."
                : "内容已移除，保留这次操作的记录。"}
            </p>
          ) : (
            <>
              <pre>{readableKernelValue(row.item.content ?? null, en)}</pre>
              <p>
                {row.item.outboundPolicy === "never_send"
                  ? en
                    ? "Never sent through Memory selection"
                    : "禁止通过 Memory 选择发送"
                  : en
                    ? "Sending requires selection and confirmation; private content cannot go to external Providers."
                    : "发送需要明确选择和确认；私有内容不能发送给外部 Provider。"}
              </p>
              <details>
                <summary>
                  {en ? "Source and retention" : "来源与保留期限"}
                </summary>
                <pre>{readableKernelValue(row.item.source ?? null, en)}</pre>
                <pre>{readableKernelValue(row.item.retention ?? null, en)}</pre>
              </details>
              <div className="brief-actions">
                {row.item.state === "candidate" ? (
                  <Button
                    disabled={busy || !!pendingCommand}
                    onClick={() =>
                      void run(() =>
                        govern({
                          action: "confirm",
                          itemId: row.item.id,
                          expectedVersion: row.item.version,
                          publicReason: en
                            ? "Use this explicitly selected context"
                            : "使用这项已明确选择的上下文",
                        }),
                      )
                    }
                  >
                    {en ? "Use this" : "开始使用"}
                  </Button>
                ) : null}
                <Button
                  disabled={busy}
                  onClick={() => {
                    edit(row.item);
                  }}
                >
                  {en ? "Edit" : "编辑"}
                </Button>
                {row.item.state === "active" ? (
                  <Button
                    disabled={busy || !!pendingCommand}
                    onClick={() =>
                      void run(() =>
                        govern({
                          action: "retire",
                          itemId: row.item.id,
                          expectedVersion: row.item.version,
                          publicReason: en
                            ? "Stop using this context"
                            : "停止使用这项上下文",
                        }),
                      )
                    }
                  >
                    {en ? "Stop using" : "停止使用"}
                  </Button>
                ) : null}
                <Button
                  disabled={busy || !!pendingCommand}
                  onClick={() => {
                    setForget(row.item);
                    setForgetConfirmed(false);
                  }}
                >
                  {en ? "Forget" : "忘记"}
                </Button>
              </div>
            </>
          )}
        </article>
      ))}
      <div className="brief-actions">
        <Button
          disabled={busy || page === 0}
          onClick={() => {
            setPage((p) => p - 1);
          }}
        >
          {en ? "Previous page" : "上一页"}
        </Button>
        <Button
          disabled={busy || (page + 1) * 20 >= filtered.length}
          onClick={() => {
            setPage((p) => p + 1);
          }}
        >
          {en ? "Next page" : "下一页"}
        </Button>
        <Button disabled={busy} onClick={() => void run(load)}>
          {en ? "Reload" : "重新读取"}
        </Button>
      </div>
      {forget ? (
        <section className="persistent-message">
          <h2 ref={forgetHeading} tabIndex={-1}>{en ? "Forget this context?" : "忘记这项上下文？"}</h2>
          <p>
            {en
              ? "This removes its local body and tracked request and assessment copies. It cannot recall information already sent or copies outside Sestina's control. Managed backups require the cleanup below. The research history and deletion proof remain."
              : "这会移除本地正文及已追踪的请求、评估副本。已发送的信息和 Sestina 无法控制的副本不能撤回。受管备份需通过下方清理处理。研究历史和删除证明仍保留。"}
          </p>
          <label>
            <input
              type="checkbox"
              checked={forgetConfirmed}
              onChange={(e) => {
                setForgetConfirmed(e.target.checked);
              }}
            />
            {en
              ? "I understand and want to forget it."
              : "我已了解，确认忘记。"}
          </label>
          <Button
            disabled={busy || !forgetConfirmed}
            onClick={() =>
              void run(async () => {
                await govern({
                  action: "forget",
                  itemId: forget.id,
                  expectedVersion: forget.version,
                  confirmation: "FORGET",
                  publicReason: "user_requested_irreversible_forget",
                });
                setForget(undefined);
              })
            }
          >
            {en ? "Confirm Forget" : "确认忘记"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setForget(undefined);
            }}
          >
            {en ? "Keep it" : "保留"}
          </Button>
        </section>
      ) : null}
      {privacy?.status === "cleanup_required" || privacy?.status === "complete_retained" ? (
        <section>
          <h2>{privacy.status === "complete_retained" ? en ? "Backups retained; restore blocked" : "备份已保留，恢复已禁用" : en ? "Local copy cleanup required" : "需要清理本地副本"}</h2>
          {privacy.status === "complete_retained" ? <p role="status">{en ? "You chose to keep the listed backups. They may still contain forgotten content. Current database pages were cleaned, and these backups cannot restore this project. You can inspect and delete them later." : "你选择保留清单中的备份，其中可能仍含已忘记内容。当前数据库旧页已清理，这些备份不能用于恢复本项目。你可以稍后检查并删除。"}</p> : null}
          <p>
            {en
              ? "Forgotten content is blocked from reuse. Check the controlled copies before deleting them; pre-forget backups cannot be restored through this project."
              : "已忘记内容已禁止重新使用。请核对受管副本后删除；本项目已禁止通过旧备份恢复已忘记内容。"}
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setPlan(
                  (await researchRoomApi.kernel(
                    projectId,
                    "privacy_copy_preview",
                    {},
                    decodeLocalJson,
                  )) as unknown as CopyPlan,
                );
                setCleanupConfirmed(false);
              })
            }
          >
            {en ? "Inspect copies" : "查看副本清单"}
          </Button>
          {privacy.status === "cleanup_required" && privacy.details?.plan ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await researchRoomApi.kernel(
                    projectId,
                    "privacy_cleanup",
                    {
                      planHash: requireLocalValue(privacy.details).plan.planHash,
                      resume: true,
                      confirmed: true,
                      copyAction: privacy.details?.copyAction ?? "delete",
                    },
                    decodeLocalJson,
                  );
                  setPlan(undefined);
                })
              }
            >
              {en ? "Continue approved cleanup" : "继续已确认的清理"}
            </Button>
          ) : null}
          {plan ? (
            <>
              <ul>
                {plan.files.map((f) => (
                  <li key={f.locationToken}>{f.locationToken}</li>
                ))}
              </ul>
              {plan.blocked.length ? (
                <p role="alert">
                  {en
                    ? "Some copies could not be verified. They have not been deleted."
                    : "部分副本无法核验，尚未删除。"}{" "}
                  {plan.blocked.join(", ")}
                </p>
              ) : null}
              <label>
                {en ? "Managed backup action" : "受管备份处理方式"}
                <select value={copyAction} onChange={event=>{setCopyAction(event.target.value === "retire" ? "retire" : "delete");setCleanupConfirmed(false);}}>
                  <option value="delete">{en ? "Delete verified copies" : "删除已核验副本"}</option>
                  <option value="retire">{en ? "Keep backups and disable restore" : "保留备份并禁用恢复"}</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={cleanupConfirmed}
                  onChange={(e) => {
                    setCleanupConfirmed(e.target.checked);
                  }}
                />
                {copyAction === "retire" ? en ? "Keep the listed backups, accepting that they may contain forgotten content. Disable restore and clean current database pages and temporary files." : "保留清单中的备份，并接受其中可能包含已忘记内容的风险。禁用恢复，清理当前数据库旧页和临时文件。" : en
                  ? "Delete the listed copies and reclaim database pages."
                  : "删除清单中的副本并清理数据库旧页。"}
              </label>
              <Button
                disabled={busy || !cleanupConfirmed || !!plan.blocked.length}
                onClick={() =>
                  void run(async () => {
                    await researchRoomApi.kernel(
                      projectId,
                      "privacy_cleanup",
                      {
                        planHash: plan.planHash,
                        resume: false,
                        confirmed: true,
                        copyAction,
                      },
                      decodeLocalJson,
                    );
                    setPlan(undefined);
                  })
                }
              >
                {copyAction === "retire" ? en ? "Retain backups and disable restore" : "保留备份并禁用恢复" : en ? "Delete listed copies" : "删除清单中的副本"}
              </Button>
            </>
          ) : null}
        </section>
      ) : privacy?.status === "complete" ? (
        <p role="status">
          {en
            ? "The approved controlled-copy cleanup is complete. Previously sent content and external copies remain outside this cleanup."
            : "已确认的受管副本清理完成。已发送内容及外部副本不在此次清理范围内。"}
        </p>
      ) : null}
    </section>
  );
}
