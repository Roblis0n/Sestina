import { requireLocalValue } from "../../api/kernel-dto.js";
import { KernelMemoryDrawer } from "./KernelMemoryDrawer.js";
import { useEffect, useState } from "react";
import { researchRoomApi, ResearchRoomApiError } from "../../api/client.js";
import {
  decodeBriefView,
  decodeLocalJson,
  decodeReview,
  type BriefFieldsDto,
  type BriefViewDto,
  type KernelReviewDto,
  type LocalJson,
  type ObjectReferenceDto,
  type ProgressiveDto,
  type ScopeDto,
} from "../../api/kernel-dto.js";
import { Button } from "../primitives/Button.js";
import { kernelLabel, readableKernelValue } from "./kernel-copy.js";
import { BriefRelationshipPicker } from "./BriefRelationshipPicker.js";

const labels: Record<string, [string, string]> = {
  projectQuestion: ["研究问题", "Research question"],
  currentTask: ["当前任务", "Current task"],
  currentStage: ["研究阶段", "Research stage"],
  targetArtifacts: ["目标产物", "Target artifacts"],
  fixedDecisions: ["历史固定约束", "Historical constraints"],
  acceptedDecisions: ["已接受决定", "Accepted decisions"],
  allowedChanges: ["允许改变", "Allowed changes"],
  forbiddenChanges: ["禁止改变", "Protected changes"],
  expectedDeltas: ["预期变化", "Expected changes"],
  evidenceBoundaries: ["证据边界", "Evidence boundaries"],
  evidenceThresholds: ["证据门槛", "Evidence thresholds"],
  knownUnknowns: ["已知未知项", "Known unknowns"],
  explicitNonGoals: ["非目标", "Non-goals"],
};
const stages = [
  ["question_formulation", "形成问题", "Question formulation"],
  ["literature_review", "文献梳理", "Literature review"],
  ["data_collection", "收集资料", "Data collection"],
  ["analysis", "分析", "Analysis"],
  ["writing", "写作", "Writing"],
  ["revision", "修改", "Revision"],
  ["review_response", "回应评审", "Review response"],
];
const operations = [
  "add",
  "rewrite",
  "delete",
  "move",
  "citation_add",
  "citation_remove",
  "data_replace",
];
const capacities = [
  "background_only",
  "descriptive",
  "interpretive",
  "associational",
  "mechanistic",
  "causal",
  "normative",
  "completion",
];
const kinds = [
  "artifact_span",
  "interview_excerpt",
  "coded_material",
  "quantitative_result",
  "policy_text",
  "literature_source",
  "user_decision",
  "system_check",
];
const empty = (): BriefFieldsDto => ({
  projectQuestion: "",
  currentTask: "",
  currentStage: "",
  targetArtifacts: [],
  fixedDecisions: [],
  allowedChanges: [],
  forbiddenChanges: [],
  expectedDeltas: [],
  evidenceBoundaries: [],
  explicitNonGoals: [],
});
const scope = (): ScopeDto => ({
  target: { kind: "project_path", relativePath: "." },
  operations: ["rewrite"],
});
function initial(v: BriefViewDto): BriefFieldsDto {
  const f = { ...empty(), ...(v.active ?? {}) };
  f.progressive = v.active?.progressive
    ? structuredClone(v.active.progressive)
    : {
        schemaVersion: "2.0.0",
        sections: Object.fromEntries(
          Object.keys(labels).map((k) => [
            k,
            v.sections[k] ?? { status: "not_provided" },
          ]),
        ),
        acceptedDecisions: [],
        knownUnknowns: [],
        evidenceThresholds: [],
      };
  f.progressive.objectReferences ??= structuredClone(v.objectVersions ?? []);
  return structuredClone(f);
}
export function ProjectBriefPanel({
  projectId,
  language,
  onReview,
  candidate,
}: {
  projectId: string;
  language: string;
  onReview: (r: KernelReviewDto) => void;
  candidate?: KernelReviewDto;
}) {
  const en = language === "en",
    label = (key: string) => labels[key]?.[en ? 1 : 0] ?? key;
  const [view, setView] = useState<BriefViewDto>();
  const [fields, setFields] = useState<BriefFieldsDto>();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<KernelReviewDto>();
  const [draftDirty, setDraftDirty] = useState(false);
  const [base, setBase] = useState<BriefViewDto["brief"]>();
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] =
    useState<
      {
        field: string;
        base: LocalJson;
        current: LocalJson;
        candidate: LocalJson;
        conflict: boolean;
      }[]
    >();
  const [choices, setChoices] = useState<
    Record<string, "current" | "candidate">
  >({});
  const [conflictRevision, setConflictRevision] = useState<number>();
  const [direction, setDirection] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const load = async () => {
    const v = await researchRoomApi.kernel(
      projectId,
      "brief",
      {},
      decodeBriefView,
    );
    setView(v);
    return v;
  };
  useEffect(() => {
    void load()
      .then((v) => {
        const payload = candidate?.effectDraft?.payload as unknown as { kind: string; mode?: string; fields?: BriefFieldsDto; changes?: Partial<BriefFieldsDto>; expectedVersion?: number; baseVersionId?: string; newQuestion?: string; reason?: string } | undefined;
        const historical = v.brief?.versions.find(version => version.id === payload?.baseVersionId);
        setBase(payload?.expectedVersion && v.brief ? { ...v.brief, version: payload.expectedVersion, currentVersionId: payload.baseVersionId ?? v.brief.currentVersionId } : v.brief);
        setFields(payload?.mode === "initialize" && payload.fields ? structuredClone(payload.fields) : payload?.changes ? { ...initial({ ...v, active: historical ?? v.active }), ...structuredClone(payload.changes) } : initial(v));
        if (candidate) { setDraft(candidate); setEditing(true); setReason(payload?.reason ?? candidate.suggestion); setDirection(payload?.kind === "formal_direction_change"); setNewQuestion(payload?.newQuestion ?? ""); }
      })
      .catch(() => {
        setError(
          en
            ? "Could not load the Brief. Reload to continue."
            : "研究简报读取失败，请重新加载。",
        );
      });
  }, [projectId, candidate?.id]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof ResearchRoomApiError &&
          ["stale_revision", "stale_object"].includes(e.code)
          ? en
            ? "The project changed. Your draft is kept; compare versions before saving."
            : "项目已变化，草稿已保留。请比较版本后再保存。"
          : en
            ? "Could not save. Check the fields and current object versions; your input is kept."
            : "未能保存。请核对字段和对象版本，已保留你的输入。",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!view || !fields)
    return (
      <section>
        <h1>{en ? "Research Brief" : "研究简报"}</h1>
        <p role="status">{error || (en ? "Loading…" : "正在读取…")}</p>
        <Button
          onClick={() =>
            void run(async () => {
              setFields(initial(await load()));
            })
          }
        >
          {en ? "Reload" : "重新加载"}
        </Button>
      </section>
    );
  const p = requireLocalValue(fields.progressive);
  const change = (key: string, value: unknown) => {
    setDraftDirty(true);
    setFields((old) => {
      const next = structuredClone(requireLocalValue(old));
      const pg = requireLocalValue(next.progressive);
      if (key in pg && key !== "sections") Object.assign(pg, { [key]: value });
      else Object.assign(next, { [key]: value });
      pg.sections[key] = {
        status:
          typeof value === "string"
            ? value.trim()
              ? "provided"
              : "not_provided"
            : Array.isArray(value) && value.length
              ? "provided"
              : "not_provided",
      };
      return next;
    });
  };
  const stateChange = (key: string, status: string) => {
    setDraftDirty(true);
    setFields((old) => {
      const next = structuredClone(requireLocalValue(old)),
        pg = requireLocalValue(next.progressive);
      if (status !== "provided") {
        if (key in pg) Object.assign(pg, { [key]: [] });
        else
          Object.assign(next, {
            [key]: ["projectQuestion", "currentTask", "currentStage"].includes(
              key,
            )
              ? ""
              : [],
          });
      }
      pg.sections[key] =
        status === "intentionally_empty"
          ? { status, publicReason: "" }
          : { status: status as "provided" | "not_provided" };
      return next;
    });
  };
  const rememberRef = (ref: ObjectReferenceDto) => {
    setFields((old) => {
      const next = structuredClone(requireLocalValue(old));
      requireLocalValue(next.progressive).objectReferences = [
        ...(requireLocalValue(next.progressive).objectReferences ?? []).filter(
          (r) => r.id !== ref.id,
        ),
        ref,
      ];
      return next;
    });
  };
  const picker = (
    kind: ObjectReferenceDto["kind"],
    selected: ObjectReferenceDto[],
    add: (r: ObjectReferenceDto) => void,
    remove: (r: ObjectReferenceDto) => void,
  ) => (
    <BriefRelationshipPicker
      projectId={projectId}
      language={language}
      kind={kind}
      selected={selected}
      onSelect={(r) => {
        add(r);
        rememberRef(r);
      }}
      onRemove={remove}
    />
  );
  const scopes = (value: ScopeDto, onChange: (s: ScopeDto) => void) => (
    <div className="brief-scope">
      <label>
        {en ? "Scope" : "作用范围"}
        <select
          value={value.target.kind}
          onChange={(e) => {
            onChange({
              ...value,
              target:
                e.target.value === "project_path"
                  ? { kind: "project_path", relativePath: "." }
                  : { kind: "artifact", artifactId: "" },
            });
          }}
        >
          <option value="project_path">
            {en ? "Project path" : "项目相对路径"}
          </option>
          <option value="artifact">{en ? "Artifact" : "产物"}</option>
          {!["project_path", "artifact"].includes(value.target.kind) ? (
            <option value={value.target.kind}>
              {en ? "Existing scoped location" : "已有局部范围"}
            </option>
          ) : null}
        </select>
      </label>
      {value.target.kind === "project_path" ? (
        <label>
          {en ? "Relative path" : "相对路径"}
          <input
            value={value.target.relativePath}
            onChange={(e) => {
              onChange({
                ...value,
                target: { kind: "project_path", relativePath: e.target.value },
              });
            }}
          />
        </label>
      ) : (
        picker(
          "artifact",
          value.target.artifactId
            ? [{ kind: "artifact", id: value.target.artifactId, version: 1 }]
            : [],
          (r) => {
            onChange({
              ...value,
              target: { kind: "artifact", artifactId: r.id },
            });
          },
          () => {
            onChange({
              ...value,
              target: { kind: "artifact", artifactId: "" },
            });
          },
        )
      )}
      <label>
        {en ? "Operations" : "允许的操作"}
        <select
          multiple
          value={value.operations}
          onChange={(e) => {
            onChange({
              ...value,
              operations: Array.from(e.target.selectedOptions, (o) => o.value),
            });
          }}
        >
          {operations.map((o) => (
            <option key={o} value={o}>
              {kernelLabel(o, en)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  const listEditor = (
    key:
      | "fixedDecisions"
      | "expectedDeltas"
      | "evidenceBoundaries"
      | "allowedChanges"
      | "forbiddenChanges",
  ) => {
    const rows = fields[key],
      update = (index: number, row: unknown) => {
        change(
          key,
          rows.map((old, i) => (i === index ? row : old)),
        );
      };
    return (
      <>
        {rows.map((row, i) => (
          <fieldset key={i}>
            <legend>
              {label(key)} {i + 1}
            </legend>
            {"statement" in row ? (
              <>
                <label>
                  {en ? "Statement" : "具体内容"}
                  <textarea
                    value={row.statement}
                    onChange={(e) => {
                      update(i, { ...row, statement: e.target.value });
                    }}
                  />
                </label>
                {scopes(row.scope, (s) => {
                  update(i, { ...row, scope: s });
                })}
                {key === "evidenceBoundaries" ? (
                  <>
                    <label>
                      {en ? "Excluded inferences" : "不允许的推断"}
                      <select
                        multiple
                        value={row.forbiddenInferenceKinds ?? []}
                        onChange={(e) => {
                          update(i, {
                            ...row,
                            forbiddenInferenceKinds: Array.from(
                              e.target.selectedOptions,
                              (o) => o.value,
                            ),
                          });
                        }}
                      >
                        {capacities.map((c) => (
                          <option key={c} value={c}>
                            {kernelLabel(c, en)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {picker(
                      "evidence",
                      (row.allowedSourceIds ?? []).map((id) => ({
                        kind: "evidence",
                        id,
                        version: 1,
                      })),
                      (r) => {
                        update(i, {
                          ...row,
                          allowedSourceIds: [
                            ...new Set([...(row.allowedSourceIds ?? []), r.id]),
                          ],
                        });
                      },
                      (r) => {
                        update(i, {
                          ...row,
                          allowedSourceIds: row.allowedSourceIds?.filter(
                            (id) => id !== r.id,
                          ),
                        });
                      },
                    )}
                  </>
                ) : null}
              </>
            ) : (
              scopes(row, (s) => {
                update(i, s);
              })
            )}
            <Button
              onClick={() => {
                change(
                  key,
                  rows.filter((_, j) => i !== j),
                );
              }}
            >
              {en ? "Remove" : "移除此项"}
            </Button>
          </fieldset>
        ))}
        <Button
          onClick={() => {
            change(key, [
              ...rows,
              key === "allowedChanges" || key === "forbiddenChanges"
                ? scope()
                : {
                    statement: "",
                    scope: scope(),
                    ...(key === "evidenceBoundaries"
                      ? { forbiddenInferenceKinds: [] }
                      : {}),
                  },
            ]);
          }}
        >
          {en ? "Add item" : "添加一项"}
        </Button>
      </>
    );
  };
  async function saveDraft() {
    if (!fields || !view) return;
    if (!fields.projectQuestion.trim() && !fields.currentTask.trim()) {
      setError(
        en
          ? "Enter a question or a current task."
          : "请填写研究问题或当前任务。 ",
      );
      return;
    }
    if (!reason.trim()) {
      setError(
        en ? "Explain this change briefly." : "请简要说明这次修改的理由。",
      );
      return;
    }
    if (
      Object.values(p.sections).some(
        (s) => s.status === "intentionally_empty" && !s.publicReason.trim(),
      )
    ) {
      setError(
        en
          ? "Explain each intentionally empty section."
          : "请说明明确为空的字段为何不适用。",
      );
      return;
    }
    for (const [key,state] of Object.entries(p.sections)) {
      const contents = key in p ? p[key as keyof typeof p] : fields[key as keyof BriefFieldsDto];
      if (state.status === "provided" && (typeof contents === "string" ? !contents.trim() : Array.isArray(contents) ? contents.length === 0 : contents === undefined)) { setError(`${label(key)}: ${en ? "provide information or choose another field state." : "请填写内容，或调整字段状态。"}`); return; }
    }
    const referenced = new Set<string>();
    const visit = (value: unknown): void => { if (typeof value === "string") referenced.add(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") Object.entries(value).filter(([key]) => key !== "objectReferences").forEach(([,child])=>{ visit(child); }); };
    visit(fields);
    const progressive = { ...p, objectReferences: (p.objectReferences ?? view.objectVersions ?? []).filter(ref=>referenced.has(ref.id)) };
    let r = draft;
    if (!r || ["committed", "disposed", "cancelled"].includes(r.status))
      r = await researchRoomApi.kernel(
        projectId,
        "create",
        { suggestion: reason },
        decodeReview,
      );
    r = await researchRoomApi.kernel(
      projectId,
      "skip_assessment",
      { reviewId: r.id, expectedVersion: r.version, selection: { coverageScope: { effectKind: direction ? "formal_direction_change" : "patch_brief", targetKinds: [] } } },
      decodeReview,
    );
    setDraft(r);
    const changes = Object.fromEntries(
      Object.keys(empty())
        .filter((k) => k !== "projectQuestion")
        .map((k) => [k, fields[k as keyof BriefFieldsDto]]),
    );
    const payload = !base
      ? { kind: "patch_brief", mode: "initialize", fields: { ...fields, progressive }, reason }
      : direction
        ? {
            kind: "formal_direction_change",
            targetId: base.id,
            expectedVersion: base.version,
            baseVersionId: base.currentVersionId,
            newQuestion,
            impactSummary: reason,
            reason,
          }
        : {
            kind: "patch_brief",
            targetId: base.id,
            expectedVersion: base.version,
            baseVersionId: base.currentVersionId,
            changes: { ...changes, progressive },
            reason,
          };
    r = await researchRoomApi.kernel(
      projectId,
      "prepare_effect",
      { reviewId: r.id, expectedVersion: r.version, payload },
      decodeReview,
    );
    setDraft(r);
    setDraftDirty(false);
    setNotice(
      en
        ? "Draft saved. Review the changes before confirming."
        : "草稿已保存，请核对修改后再确认。",
    );
  }
  return (
    <section className="project-brief-panel" aria-busy={busy}>
      <header>
        <h1>{en ? "Research Brief" : "研究简报"}</h1>
        <p>
          {view.active
            ? view.active.projectQuestion || view.active.currentTask
            : en
              ? "Start with a question or a task. Add details when needed."
              : "先写下一个问题或当前任务，需要时再补充细节。"}
        </p>
        <div className="brief-actions">
          <Button
            disabled={busy}
            onClick={() => {
              setEditing(!editing);
              setNotice("");
            }}
          >
            {editing
              ? en
                ? "Close editor"
                : "收起编辑"
              : en
                ? "Edit Brief"
                : "修改简报"}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const v = await load();
                if (!editing) setFields(initial(v));
              })
            }
          >
            {en ? "Check current version" : "核对当前版本"}
          </Button>
        </div>
      </header>
      <KernelMemoryDrawer projectId={projectId} en={en}/>
      <details><summary>{en ? "Context for reviewing this change" : "评估本次修改所需的上下文"}</summary>
        <p>{en ? "These checks use the saved Brief. Missing context can limit an assessment; you can still make a valid change." : "以下检查使用已保存的简报。缺少上下文会限制评估，你仍然可以进行合法修改。"}</p>
        <ul>{(view.coverage?.[direction ? "formal_direction_change" : "patch_brief"] ?? []).filter(row => row.status !== "not_applicable").map(row => <li key={row.section}>{label(row.section)}：{row.status === "limited" ? en ? "Not provided; you may add it or continue" : "未提供，可以补充，也可以先继续" : en ? "Provided or explicitly left empty" : "已填写或已说明为空"}</li>)}</ul>
      </details>
      {view.fileProjection?.status !== "ready" || view.fileProjection.source_revision !== view.projectStateRevision ? <aside className="persistent-message"><p>{en ? "The project Brief is saved. Its local file needs refreshing from the saved version." : "项目简报已经保存，本地简报文件需要按已保存版本刷新。"}</p><Button disabled={busy} onClick={() => void run(async () => { await researchRoomApi.kernel(projectId, "publish_brief", {}, decodeLocalJson); await load(); })}>{en ? "Refresh local Brief file" : "刷新本地简报文件"}</Button></aside> : null}
      {error ? (
        <p role="alert" className="persistent-message">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {editing || !view.active ? (
        <div className="brief-form" onChange={() => { setDraftDirty(true); }}>
          {Object.keys(labels).map((key) => {
            const s = p.sections[key] ?? { status: "not_provided" };
            return (
              <details
                key={key}
                open={
                  ["projectQuestion", "currentTask"].includes(key) || undefined
                }
              >
                <summary>
                  {label(key)}{" "}
                  <span>
                    {s.status === "provided"
                      ? en
                        ? "Provided"
                        : "已填写"
                      : s.status === "intentionally_empty"
                        ? en
                          ? "Intentionally empty"
                          : "明确为空"
                        : en
                          ? "Not provided"
                          : "未提供"}
                  </span>
                </summary>
                <div className="brief-section-body">
                  <label>
                    {en ? "Field state" : "字段状态"}
                    <select
                      value={s.status}
                      disabled={key === "projectQuestion" && !!view.active}
                      onChange={(e) => {
                        stateChange(key, e.target.value);
                      }}
                    >
                      <option value="not_provided">
                        {en ? "Not provided" : "未提供"}
                      </option>
                      <option value="provided">
                        {en ? "Provide information" : "填写信息"}
                      </option>
                      <option value="intentionally_empty">
                        {en ? "Intentionally empty" : "明确为空"}
                      </option>
                    </select>
                  </label>
                  {s.status === "intentionally_empty" ? (
                    <label>
                      {en ? "Why is this empty?" : "为空的理由"}
                      <textarea
                        value={s.publicReason}
                        onChange={(e) => {
                          setFields((old) => ({
                            ...requireLocalValue(old),
                            progressive: {
                              ...requireLocalValue(requireLocalValue(old).progressive),
                              sections: {
                                ...requireLocalValue(requireLocalValue(old).progressive).sections,
                                [key]: {
                                  status: "intentionally_empty",
                                  publicReason: e.target.value,
                                },
                              },
                            },
                          }));
                        }}
                      />
                    </label>
                  ) : null}
                  {["projectQuestion", "currentTask"].includes(key) ? (
                    <label>
                      {label(key)}
                      <textarea
                        value={key === "projectQuestion" ? fields.projectQuestion : fields.currentTask}
                        readOnly={key === "projectQuestion" && !!view.active}
                        onChange={(e) => {
                          change(key, e.target.value);
                        }}
                      />
                    </label>
                  ) : null}
                  {key === "currentStage" ? (
                    <label>
                      {label(key)}
                      <select
                        value={fields.currentStage}
                        onChange={(e) => {
                          change(key, e.target.value);
                        }}
                      >
                        <option value="">
                          {en ? "Not yet specified" : "暂未填写"}
                        </option>
                        {stages.map(([v, zh, eng]) => (
                          <option key={v} value={v}>
                            {en ? eng : zh}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {key === "targetArtifacts"
                    ? picker(
                        "artifact",
                        fields.targetArtifacts.map((id) => ({
                          id,
                          kind: "artifact",
                          version: 1,
                        })),
                        (r) => {
                          change(key, [
                            ...new Set([...fields.targetArtifacts, r.id]),
                          ]);
                        },
                        (r) => {
                          change(
                            key,
                            fields.targetArtifacts.filter((id) => id !== r.id),
                          );
                        },
                      )
                    : null}
                  {key === "acceptedDecisions"
                    ? picker(
                        "decision",
                        p.acceptedDecisions,
                        (r) => {
                          change(key, [
                            ...p.acceptedDecisions.filter((a) => a.id !== r.id),
                            r,
                          ]);
                        },
                        (r) => {
                          change(
                            key,
                            p.acceptedDecisions.filter((a) => a.id !== r.id),
                          );
                        },
                      )
                    : null}
                  {[
                    "fixedDecisions",
                    "allowedChanges",
                    "forbiddenChanges",
                    "expectedDeltas",
                    "evidenceBoundaries",
                  ].includes(key)
                    ? listEditor(key as Parameters<typeof listEditor>[0])
                    : null}
                  {key === "explicitNonGoals" ? (
                    <>
                      {fields.explicitNonGoals.map((s, i) => (
                        <div key={i} className="brief-row">
                          <label>
                            {label(key)} {i + 1}
                            <input
                              value={s}
                              onChange={(e) => {
                                change(
                                  key,
                                  fields.explicitNonGoals.map((x, j) =>
                                    j === i ? e.target.value : x,
                                  ),
                                );
                              }}
                            />
                          </label>
                          <Button
                            onClick={() => {
                              change(
                                key,
                                fields.explicitNonGoals.filter(
                                  (_, j) => j !== i,
                                ),
                              );
                            }}
                          >
                            {en ? "Remove" : "移除"}
                          </Button>
                        </div>
                      ))}
                      <Button
                        onClick={() => {
                          change(key, [...fields.explicitNonGoals, ""]);
                        }}
                      >
                        {en ? "Add non-goal" : "添加非目标"}
                      </Button>
                    </>
                  ) : null}
                  {key === "knownUnknowns" ? (
                    <>
                      {p.knownUnknowns.map((u, i) => {
                        const update = (
                          patch: Partial<
                            ProgressiveDto["knownUnknowns"][number]
                          >,
                        ) => {
                          change(
                            key,
                            p.knownUnknowns.map((old, j) =>
                              j === i ? { ...old, ...patch } : old,
                            ),
                          );
                        };
                        return (
                          <fieldset key={i}>
                            <legend>
                              {label(key)} {i + 1}
                            </legend>
                            <label>
                              {en ? "What is unknown?" : "尚不清楚的内容"}
                              <textarea
                                value={u.statement}
                                onChange={(e) => {
                                  update({ statement: e.target.value });
                                }}
                              />
                            </label>
                            <label>
                              {en ? "Importance" : "重要性"}
                              <select
                                value={u.importance}
                                onChange={(e) => {
                                  update({ importance: e.target.value });
                                }}
                              >
                                <option value="blocking">
                                  {en ? "Blocking" : "阻碍推进"}
                                </option>
                                <option value="material">
                                  {en ? "Material" : "重要"}
                                </option>
                                <option value="background">
                                  {en ? "Background" : "背景"}
                                </option>
                              </select>
                            </label>
                            <label>
                              {en
                                ? "How could this be resolved?"
                                : "满足什么条件可以澄清"}
                              <input
                                value={u.resolutionCondition ?? ""}
                                onChange={(e) => {
                                  update({
                                    resolutionCondition:
                                      e.target.value || undefined,
                                  });
                                }}
                              />
                            </label>
                            {(
                              [
                                "issue",
                                "evidence",
                                "decision",
                                "artifact",
                              ] as const
                            ).map((kind) => (
                              <details key={kind}>
                                <summary>{kernelLabel(kind, en)}</summary>
                                {picker(
                                  kind,
                                  u.relatedObjectRefs.filter(
                                    (r) => r.kind === kind,
                                  ),
                                  (r) => {
                                    update({
                                      relatedObjectRefs: [
                                        ...u.relatedObjectRefs.filter(
                                          (o) => o.id !== r.id,
                                        ),
                                        r,
                                      ],
                                    });
                                  },
                                  (r) => {
                                    update({
                                      relatedObjectRefs:
                                        u.relatedObjectRefs.filter(
                                          (o) => o.id !== r.id,
                                        ),
                                    });
                                  },
                                )}
                              </details>
                            ))}
                            <Button
                              onClick={() => {
                                change(
                                  key,
                                  p.knownUnknowns.filter((_, j) => i !== j),
                                );
                              }}
                            >
                              {en ? "Remove" : "移除"}
                            </Button>
                          </fieldset>
                        );
                      })}
                      <Button
                        onClick={() => {
                          change(key, [
                            ...p.knownUnknowns,
                            {
                              statement: "",
                              importance: "material",
                              relatedObjectRefs: [],
                            },
                          ]);
                        }}
                      >
                        {en ? "Add unknown" : "添加未知项"}
                      </Button>
                    </>
                  ) : null}
                  {key === "evidenceThresholds" ? (
                    <>
                      {p.evidenceThresholds.map((t, i) => {
                        const update = (
                          patch: Partial<
                            ProgressiveDto["evidenceThresholds"][number]
                          >,
                        ) => {
                          change(
                            key,
                            p.evidenceThresholds.map((old, j) =>
                              j === i ? { ...old, ...patch } : old,
                            ),
                          );
                        };
                        return (
                          <fieldset key={i}>
                            <legend>
                              {label(key)} {i + 1}
                            </legend>
                            <label>
                              {en ? "Applies to" : "适用对象"}
                              <select
                                value={t.appliesTo}
                                onChange={(e) => {
                                  update({ appliesTo: e.target.value });
                                }}
                              >
                                {[
                                  "claim",
                                  "decision",
                                  "direction_change",
                                  "completion",
                                ].map((v) => (
                                  <option key={v} value={v}>
                                    {kernelLabel(v, en)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              {en ? "Source class" : "来源类别"}
                              <select
                                value={t.minimumSourceClass}
                                onChange={(e) => {
                                  update({
                                    minimumSourceClass: e.target.value,
                                  });
                                }}
                              >
                                {kinds.map((v) => (
                                  <option key={v} value={v}>
                                    {kernelLabel(v, en)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              {en ? "Required corroboration" : "交叉印证数量"}
                              <input
                                type="number"
                                min="1"
                                max="1000"
                                value={t.requiredCorroboration ?? ""}
                                onChange={(e) => {
                                  update({
                                    requiredCorroboration: e.target.value
                                      ? Number(e.target.value)
                                      : undefined,
                                  });
                                }}
                              />
                            </label>
                            <label>
                              {en ? "Allowed inference" : "允许的推断范围"}
                              <select
                                multiple
                                value={t.acceptedInferenceCapacity}
                                onChange={(e) => {
                                  update({
                                    acceptedInferenceCapacity: Array.from(
                                      e.target.selectedOptions,
                                      (o) => o.value,
                                    ),
                                  });
                                }}
                              >
                                {capacities.map((v) => (
                                  <option key={v} value={v}>
                                    {kernelLabel(v, en)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              {en ? "Reason" : "理由"}
                              <textarea
                                value={t.publicReason}
                                onChange={(e) => {
                                  update({ publicReason: e.target.value });
                                }}
                              />
                            </label>
                            <Button
                              onClick={() => {
                                change(
                                  key,
                                  p.evidenceThresholds.filter(
                                    (_, j) => i !== j,
                                  ),
                                );
                              }}
                            >
                              {en ? "Remove" : "移除"}
                            </Button>
                          </fieldset>
                        );
                      })}
                      <Button
                        onClick={() => {
                          change(key, [
                            ...p.evidenceThresholds,
                            {
                              appliesTo: "claim",
                              minimumSourceClass: "literature_source",
                              acceptedInferenceCapacity: [],
                              publicReason: "",
                            },
                          ]);
                        }}
                      >
                        {en ? "Add threshold" : "添加门槛"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </details>
            );
          })}
          {view.active ? (
            <details>
              <summary>
                {en ? "Change the research question" : "改变研究问题"}
              </summary>
              <label>
                <input
                  type="checkbox"
                  checked={direction}
                  onChange={(e) => {
                    setDirection(e.target.checked);
                    setDraft(undefined);
                  }}
                />
                {en ? "Prepare a formal direction change" : "准备正式改变方向"}
              </label>
              {direction ? (
                <label>
                  {en ? "New research question" : "新的研究问题"}
                  <textarea
                    value={newQuestion}
                    onChange={(e) => {
                      setNewQuestion(e.target.value);
                      setDraft(undefined);
                    }}
                  />
                </label>
              ) : null}
            </details>
          ) : null}
          <label>
            {en ? "Reason for this change" : "本次修改的理由"}
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </label>
          <div className="brief-actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run(saveDraft)}
            >
              {en ? "Save draft" : "保存草稿"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setFields(initial(view));
                setEditing(false);
                setDraft(undefined);
                setReason("");
              }}
            >
              {en ? "Cancel editing" : "取消编辑"}
            </Button>
          </div>
        </div>
      ) : (
        <dl>
          {Object.keys(labels).map((key) => (
            <div key={key}>
              <dt>{label(key)}</dt>
              <dd>
                {p.sections[key]?.status === "intentionally_empty"
                  ? (p.sections[key] as { publicReason: string }).publicReason
                  : p.sections[key]?.status === "provided"
                    ? <pre>{readableKernelValue((key in p ? p[key as keyof typeof p] : fields[key as keyof BriefFieldsDto]) as unknown as LocalJson, en, view.objectLabels)}</pre>
                    : en
                      ? "Not provided"
                      : "未提供"}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {draft?.effectDraft && !draftDirty ? (
        <section className="brief-preview">
          <h2>{en ? "Check changes" : "核对修改"}</h2>
          <p>{reason}</p>
          <Button
            disabled={busy}
            onClick={() => {
              onReview(draft);
            }}
          >
            {en ? "View changes and confirm" : "查看修改并确认"}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const c = (await researchRoomApi.kernel(
                  projectId,
                  "brief_conflict",
                  { reviewId: draft.id },
                  decodeLocalJson,
                )) as unknown as { fields: NonNullable<typeof conflict>; projectStateRevision: number };
                setConflict(c.fields);
                setConflictRevision(c.projectStateRevision);
                setChoices({});
              })
            }
          >
            {en ? "Compare current version" : "比较当前版本"}
          </Button>
        </section>
      ) : null}
      {conflict ? (
        <section>
          <h2>{en ? "Compare versions" : "比较版本"}</h2>
          {conflict.map((row) => (
            <fieldset key={row.field}>
              <legend>{label(row.field.split(".").at(-1) ?? row.field)}{row.field.includes(".sections.") ? en ? " — field state" : " · 字段状态" : ""}</legend>
              <div className="brief-diff">
                <div>
                  <strong>{en ? "Base" : "编辑时版本"}</strong>
                  <pre>{readableKernelValue(row.base, en)}</pre>
                </div>
                <div>
                  <strong>{en ? "Current" : "当前版本"}</strong>
                  <pre>{readableKernelValue(row.current, en)}</pre>
                </div>
                <div>
                  <strong>{en ? "Your draft" : "你的草稿"}</strong>
                  <pre>{readableKernelValue(row.candidate, en)}</pre>
                </div>
              </div>
              {row.conflict ? (
                <label>
                  {en ? "Choose a value" : "选择采用的内容"}
                  <select
                    value={choices[row.field] ?? ""}
                    onChange={(e) => {
                      setChoices((old) => ({
                        ...old,
                        [row.field]: e.target.value as "current" | "candidate",
                      }));
                    }}
                  >
                    <option value="">
                      {en ? "Choose explicitly" : "请选择"}
                    </option>
                    <option value="current">
                      {en ? "Current" : "当前版本"}
                    </option>
                    <option value="candidate">
                      {en ? "My draft" : "我的草稿"}
                    </option>
                  </select>
                </label>
              ) : null}
            </fieldset>
          ))}
          <Button
            disabled={
              busy || conflict.some((r) => r.conflict && !choices[r.field])
            }
            onClick={() =>
              void run(async () => {
                const current = await load();
                if(current.projectStateRevision !== conflictRevision) throw new ResearchRoomApiError("stale_revision","Compare the current version again");
                setFields((old) => {
                  const updated=structuredClone(requireLocalValue(old));
                  for(const row of conflict) {
                    const value=choices[row.field] === "current" ? row.current : row.candidate;
                    const parts=row.field.split(".");
                    if(parts.length === 1 && Object.hasOwn(labels,row.field)) Object.assign(updated,{[row.field]:value});
                    else if(parts[0] === "progressive" && parts[1] === "sections" && parts[2] && Object.hasOwn(labels,parts[2])) Object.assign(requireLocalValue(updated.progressive).sections,{[parts[2]]:value});
                    else if(parts[0] === "progressive" && parts.length === 2 && ["knownUnknowns","acceptedDecisions","evidenceThresholds","objectReferences"].includes(parts[1] ?? "")) Object.assign(requireLocalValue(updated.progressive),{[requireLocalValue(parts[1])]:value ?? []});
                    else throw new Error("invalid_payload");
                  }
                  return updated;
                });
                setConflict(undefined);
                setNotice(
                  en
                    ? "Choices applied to the draft. Save a new preview before confirming."
                    : "已将选择应用到草稿。请重新保存预览后确认。",
                );
                setView(current);
                setBase(current.brief);
                setDraftDirty(true);
              })
            }
          >
            {en ? "Apply choices to draft" : "将选择应用到草稿"}
          </Button>
        </section>
      ) : null}
      <details>
        <summary>
          {en ? "Version history" : "版本历史"} (
          {view.brief?.versions.length ?? 0})
        </summary>
        {view.brief?.versions
          .slice()
          .reverse()
          .map((v) => (
            <article key={v.id}>
              <h3>
                {en ? "Version" : "版本"} {v.versionNumber}
              </h3>
              <p>{v.projectQuestion || v.currentTask}</p>
              <time>
                {new Date(v.createdAt).toLocaleString(en ? "en" : "zh-CN")}
              </time>
              <details>
                <summary>{en ? "Technical view" : "技术详情"}</summary>
                <pre>{JSON.stringify(v, null, 2)}</pre>
              </details>
            </article>
          ))}
      </details>
    </section>
  );
}
