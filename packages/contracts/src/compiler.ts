import { createHash } from "node:crypto";
import {
  ProjectIdSchema,
  TaskIdSchema,
  TaskContractSchema,
  TimestampSchema,
  generateId,
  SestinaError,
  SestinaErrorCode,
  type Boundary,
  type ContractId,
  type ContractTemplate,
  type Deliverable,
  type MaterialAmbiguity,
  type Objective,
  type ScopeItem,
  type SemanticCompleteness,
  type SourceRef,
  type SourceSpan,
  type TaskContract,
  type TaskId,
} from "@sestina/schema";
import {
  DEFAULT_MAX_EXTRACTOR_INPUT_CHARS,
  DEFAULT_MAX_EXTRACTOR_OUTPUT_BYTES,
  runSemanticExtractor,
  type ContractSemanticExtractor,
} from "./extractor-port.js";
import { RESEARCH_TEMPLATE } from "./templates/research.js";
import { SOFTWARE_TEMPLATE } from "./templates/software.js";
import { STRATEGY_TEMPLATE } from "./templates/strategy.js";

// ── Public API (frozen by the main agent) ──

export interface CompileContractInput {
  contractId?: string; // default generateId()
  projectId: string;
  taskId: string;
  title: string;
  userPrompt: string; // raw user text; the source for SourceSpans
  userExcerpts?: readonly string[]; // verbatim excerpts preserved as sourceRefs
  templateId?: string; // must be one of the three built-in template ids
  now: string; // REQUIRED timestamp (ISO) — no implicit time
}

export interface CompilerPorts {
  ids: {
    contractId: () => string;
    deliverableId: () => string;
    boundaryId: () => string;
  };
  semanticExtractor?: ContractSemanticExtractor;
  maxExtractorInputChars: number; // default 200_000
  maxExtractorOutputBytes: number; // default 64_000
}

export interface CompileContractDetailedResult {
  contract: TaskContract;
  ambiguities: readonly MaterialAmbiguity[]; // high-impact only, decisionRequired true
  assumptions: readonly string[]; // methodological, resolved by the executor
}

/**
 * Deterministic, provider-free contract compiler (docs/22 Task 9).
 * Fidelity parser + template-defaults merger + schema validator.
 * Version is always 1 and the output always re-parses via
 * TaskContractSchema.parse. Undeclared fields stay unknown/open/assumption —
 * acceptance checks, stop conditions, hard boundaries and authorizations are
 * never fabricated. Template defaults merge BELOW user facts.
 */
export function compileInitialContract(
  input: CompileContractInput,
  ports?: Partial<CompilerPorts>,
): TaskContract {
  return compileContract(input, resolvePorts(ports)).contract;
}

export function compileContractDetailed(
  input: CompileContractInput,
  ports?: Partial<CompilerPorts>,
): CompileContractDetailedResult {
  return compileContract(input, resolvePorts(ports));
}

// ── Ports resolution ──

interface ResolvedPorts {
  ids: CompilerPorts["ids"];
  semanticExtractor: ContractSemanticExtractor | undefined;
  maxExtractorInputChars: number;
  maxExtractorOutputBytes: number;
}

function resolvePorts(ports?: Partial<CompilerPorts>): ResolvedPorts {
  return {
    ids: {
      contractId: ports?.ids?.contractId ?? generateId,
      deliverableId: ports?.ids?.deliverableId ?? generateId,
      boundaryId: ports?.ids?.boundaryId ?? generateId,
    },
    semanticExtractor: ports?.semanticExtractor,
    maxExtractorInputChars:
      ports?.maxExtractorInputChars ?? DEFAULT_MAX_EXTRACTOR_INPUT_CHARS,
    maxExtractorOutputBytes:
      ports?.maxExtractorOutputBytes ?? DEFAULT_MAX_EXTRACTOR_OUTPUT_BYTES,
  };
}

// ── Template registry ──

const BUILTIN_TEMPLATES = new Map<string, ContractTemplate>([
  [RESEARCH_TEMPLATE.templateId, RESEARCH_TEMPLATE],
  [STRATEGY_TEMPLATE.templateId, STRATEGY_TEMPLATE],
  [SOFTWARE_TEMPLATE.templateId, SOFTWARE_TEMPLATE],
]);

function resolveTemplate(templateId: string | undefined): ContractTemplate | undefined {
  if (templateId === undefined) return undefined;
  const template = BUILTIN_TEMPLATES.get(templateId);
  if (template === undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `unknown contract template id: ${templateId}`,
      undefined,
      { templateId },
    );
  }
  return template;
}

// ── Honest defaults when no template applies ──

const DEFAULT_EVIDENCE_POLICY = {
  requireSourceForClaims: false,
  minEvidenceLevel: "none" as const,
  allowUserTestimony: true,
};

const DEFAULT_AUTHORITY = {
  executorCanChooseMethods: true,
  executorCanProposeScope: true,
  executorCanSelfReview: true,
  overridesRequireUserConfirmation: true,
};

// ── Prompt fidelity parser ──

interface LineInfo {
  text: string; // line content without the trailing newline
  start: number; // UTF-16 offset of the first character
  end: number; // UTF-16 offset one past the last character
}

interface ParsedDirective {
  text: string; // verbatim matched text
  span: SourceSpan; // UTF-16 span over `text` inside the user prompt
}

interface ParsedPrompt {
  objective: ParsedDirective | undefined;
  deliverables: ParsedDirective[];
  musts: ParsedDirective[];
  prohibitions: ParsedDirective[];
  allowOnly: ParsedDirective[];
  budget: { maxToolCallsPerTask?: number; maxProviderCallsPerTask?: number };
  // Budget policy values are plain numbers (BudgetPolicySchema) and cannot
  // carry spans; the matched directive lines are preserved verbatim instead
  // and surface as sourceRefs so the numbers stay traceable.
  budgetLines: ParsedDirective[];
  deadline: { statement: string; end: string; span: SourceSpan } | undefined;
  stopConditions: ParsedDirective[];
  skipped: number;
}

function splitLines(source: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let index = 0;
  while (index < source.length) {
    let end = source.indexOf("\n", index);
    if (end === -1) end = source.length;
    let contentEnd = end;
    if (contentEnd > index && source.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    lines.push({ text: source.slice(index, contentEnd), start: index, end: contentEnd });
    index = end + 1;
  }
  return lines;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

const OBJECTIVE_LEAD = /请[^\n]*?[。！？!?]/;
const DELIVERABLES_HEADER = /^交付物\s*[:：]?\s*(.*)$/;
const MUST_HEADER = /^必须\s*[:：]?\s*(.*)$/;
const PROHIBITION_HEADER = /^(不要|禁止)\s*[:：]?\s*(.*)$/;
const ALLOW_ONLY_HEADER = /^(只允许|仅允许|只能)\s*[:：]?\s*(.*)$/;
const STOP_HEADER = /^停止条件\s*[:：]?\s*(.*)$/;
const ITEM_LINE = /^\s*(?:\d+\s*[.、)．]\s*|[-*•]\s*)\s*(.+?)\s*$/;
const DELIVERABLE_NUMBERED = /^\s*\d+\s*[.、)．]\s*/;

type SectionKind = "deliverables" | "must" | "prohibition" | "allowOnly" | "stop" | null;

function parsePrompt(source: string): ParsedPrompt {
  const result: ParsedPrompt = {
    objective: undefined,
    deliverables: [],
    musts: [],
    prohibitions: [],
    allowOnly: [],
    budget: {},
    budgetLines: [],
    deadline: undefined,
    stopConditions: [],
    skipped: 0,
  };
  const lines = splitLines(source);

  const directiveSpan = (line: LineInfo, text: string): SourceSpan => {
    const rel = line.text.indexOf(text);
    const at = rel === -1 ? 0 : rel;
    return { start: line.start + at, end: line.start + at + text.length };
  };

  const pushDirective = (
    list: ParsedDirective[],
    text: string,
    line: LineInfo,
    maxLength: number,
  ): void => {
    if (text.length === 0) return;
    if (text.length > maxLength) {
      result.skipped += 1;
      return;
    }
    list.push({ text, span: directiveSpan(line, text) });
  };

  // Objective: the leading 请… sentence, else the first non-empty line.
  const firstNonEmpty = lines.find((line) => line.text.trim() !== "");
  if (firstNonEmpty !== undefined) {
    const trimmed = firstNonEmpty.text.trim();
    const inLine = OBJECTIVE_LEAD.exec(trimmed);
    if (inLine !== null) {
      const rel = trimmed.indexOf(inLine[0]);
      result.objective = {
        text: inLine[0],
        span: {
          start: firstNonEmpty.start + firstNonEmpty.text.indexOf(trimmed) + rel,
          end:
            firstNonEmpty.start + firstNonEmpty.text.indexOf(trimmed) + rel + inLine[0].length,
        },
      };
    } else {
      const anywhere = OBJECTIVE_LEAD.exec(source);
      if (anywhere !== null) {
        result.objective = {
          text: anywhere[0],
          span: { start: anywhere.index, end: anywhere.index + anywhere[0].length },
        };
      } else {
        result.objective = {
          text: trimmed,
          span: directiveSpan(firstNonEmpty, trimmed),
        };
      }
    }
  }

  let section: SectionKind = null;

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (trimmed === "") continue;

    if (trimmed.startsWith("预算")) {
      section = null;
      // Every (cap, label) pair on the line gets its own category; a pair
      // whose label names no category is ambiguous and is skipped, never
      // guessed.
      const pairs = [
        ...trimmed.matchAll(/(?:最多|不超过|上限)\s*(\d+)\s*次\s*([^，。,\n]*)/g),
      ];
      if (pairs.length === 0) {
        result.skipped += 1;
        continue;
      }
      let landed = 0;
      for (const pair of pairs) {
        const value = Number(pair[1]);
        const label = (pair[2] ?? "").trim();
        if (/provider|模型|api/i.test(label)) {
          result.budget.maxProviderCallsPerTask = value;
          landed += 1;
        } else if (/工具|tool|命令|操作/i.test(label)) {
          result.budget.maxToolCallsPerTask = value;
          landed += 1;
        } else {
          result.skipped += 1;
        }
      }
      // Preserve the directive line verbatim only when it actually contributed
      // a budget value — a line whose pairs all failed attribution is skipped,
      // not recorded as a budget source.
      if (landed > 0) {
        result.budgetLines.push({
          text: trimmed,
          span: directiveSpan(line, trimmed),
        });
      }
      continue;
    }

    if (trimmed.startsWith("截止")) {
      section = null;
      const date =
        /(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
          trimmed,
        );
      const year = date?.[1];
      const month = date?.[2];
      const day = date?.[3];
      const hour = date?.[4];
      const minute = date?.[5];
      const second = date?.[6] ?? "00";
      if (year === undefined || month === undefined || day === undefined) {
        result.skipped += 1;
        continue;
      }
      const y = Number(year);
      const mo = Number(month);
      const d = Number(day);
      const validDate = mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
      const validTime =
        hour === undefined ||
        (Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60);
      // A time-of-day that is present but unparseable, a calendar-invalid
      // date, or a statement over the schema bound: skip and report rather
      // than fabricate a deadline or fail as an internal error.
      const restAfterDate = trimmed.slice(
        (date?.index ?? 0) + (date?.[0]?.length ?? 0),
      );
      const timePresentButUnparseable =
        hour === undefined && /\d{1,2}:\d{2}/.test(restAfterDate);
      if (
        !validDate ||
        !validTime ||
        timePresentButUnparseable ||
        trimmed.length > 2000
      ) {
        result.skipped += 1;
        continue;
      }
      // The deadline is a date; a time of day is only recorded when the user
      // stated one — never fabricated.
      const time =
        hour === undefined
          ? "00:00:00.000Z"
          : `${hour.padStart(2, "0")}:${minute}:${second.padStart(2, "0")}.000Z`;
      result.deadline = {
        statement: trimmed,
        end: `${year}-${month}-${day}T${time}`,
        span: directiveSpan(line, trimmed),
      };
      continue;
    }

    const stopMatch = STOP_HEADER.exec(trimmed);
    if (stopMatch !== null) {
      section = "stop";
      if ((stopMatch[1] ?? "").trim() !== "") {
        pushDirective(result.stopConditions, (stopMatch[1] ?? "").trim(), line, 2000);
      }
      continue;
    }

    const deliverablesMatch = DELIVERABLES_HEADER.exec(trimmed);
    if (deliverablesMatch !== null) {
      section = "deliverables";
      const rest = (deliverablesMatch[1] ?? "").trim();
      if (rest !== "") {
        const chunks = rest
          .split(/(?=\s*\d+\s*[.、)．]\s*)/)
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk !== "");
        for (const chunk of chunks) {
          pushDirective(
            result.deliverables,
            chunk.replace(DELIVERABLE_NUMBERED, "").trim(),
            line,
            2000,
          );
        }
      }
      continue;
    }

    // Inline directive lines (e.g. "必须先完成主题分析" or "必须：先做A")
    // carry the whole verbatim line as their statement so the source span
    // always rounds back to the matched text.
    const mustMatch = MUST_HEADER.exec(trimmed);
    if (mustMatch !== null) {
      section = "must";
      if ((mustMatch[1] ?? "").trim() !== "") {
        pushDirective(result.musts, trimmed, line, 3000);
      }
      continue;
    }

    const prohibitionMatch = PROHIBITION_HEADER.exec(trimmed);
    if (prohibitionMatch !== null) {
      section = "prohibition";
      if ((prohibitionMatch[2] ?? "").trim() !== "") {
        pushDirective(result.prohibitions, trimmed, line, 3000);
      }
      continue;
    }

    const allowOnlyMatch = ALLOW_ONLY_HEADER.exec(trimmed);
    if (allowOnlyMatch !== null) {
      section = "allowOnly";
      if ((allowOnlyMatch[2] ?? "").trim() !== "") {
        pushDirective(result.allowOnly, trimmed, line, 3000);
      }
      continue;
    }

    if (section !== null) {
      const itemText = ITEM_LINE.exec(line.text)?.[1];
      if (itemText !== undefined) {
        const text = itemText.trim();
        if (section === "must") pushDirective(result.musts, text, line, 3000);
        else if (section === "prohibition") pushDirective(result.prohibitions, text, line, 3000);
        else if (section === "allowOnly") pushDirective(result.allowOnly, text, line, 3000);
        else if (section === "stop") pushDirective(result.stopConditions, text, line, 2000);
        else if (
          MUST_HEADER.test(text) ||
          PROHIBITION_HEADER.test(text) ||
          ALLOW_ONLY_HEADER.test(text)
        ) {
          // A directive bullet inside the deliverables section is a
          // requirement, not a producible artifact — skip it and report.
          result.skipped += 1;
        } else {
          pushDirective(result.deliverables, text, line, 2000);
        }
        continue;
      }
      // A non-blank, non-item line inside a list section cannot be parsed
      // safely; leave it out and document the skip instead of guessing.
      result.skipped += 1;
      continue;
    }

    // Outside any section: recognizable directive markers must never vanish
    // silently. A bare list item starting with a directive marker is an
    // explicit directive; marker-bearing prose is counted as skipped so the
    // honesty notes report it. The objective line is exempt — its verbatim
    // text is already preserved as objective.primary.
    const objectiveSpan = result.objective?.span;
    const lineEnd = line.start + line.text.length;
    const coversObjective =
      objectiveSpan !== undefined &&
      objectiveSpan.start >= line.start &&
      objectiveSpan.end <= lineEnd;
    if (!coversObjective) {
      const bareItem = ITEM_LINE.exec(line.text)?.[1]?.trim();
      const bare = bareItem ?? trimmed;
      if (MUST_HEADER.test(bare)) {
        pushDirective(result.musts, bare, line, 3000);
        continue;
      }
      if (PROHIBITION_HEADER.test(bare)) {
        pushDirective(result.prohibitions, bare, line, 3000);
        continue;
      }
      if (ALLOW_ONLY_HEADER.test(bare)) {
        pushDirective(result.allowOnly, bare, line, 3000);
        continue;
      }
      if (/(?:必须|不要|禁止|只允许|仅允许|只能)/.test(bare)) {
        result.skipped += 1;
      }
    }
  }

  return result;
}

// ── Boundary helpers ──

function mustBoundaryKind(text: string): Boundary["kind"] {
  if (/(?:替代|主任务|目标|宗旨|核心)/.test(text)) return "objective";
  return "process";
}

function prohibitionBoundaryKind(text: string): Boundary["kind"] {
  if (/(?:修改|写入|编辑|删除|移动|执行|运行)/.test(text)) return "action";
  if (/(?:读取|查看|访问|浏览|隐私|数据)/.test(text)) return "privacy";
  return "action";
}

// A prohibition is hard (non-overridable) only when it has a clear safety or
// protection sense — irreversibility, data/privacy, credentials, network,
// publishing, permissions. A stylistic preference ("不要使用红色字体") is
// demoted to a soft, overridable boundary.
const SAFETY_SENSE =
  /(?:修改|写入|编辑|删除|移除|移动|执行|运行|访问|读取|数据|隐私|秘密|密钥|密码|凭据|上传|发布|共享|泄露|泄漏|网络|外部|覆盖|安装|卸载|重启|格式化|关闭|禁用|授权|权限)/;

function extractPaths(text: string): string[] {
  const paths: string[] = [];
  const pattern = /(?:\.\/|\.\\|\/)[\w一-鿿\-.\\/]+/g;
  let match = pattern.exec(text);
  while (match !== null) {
    paths.push(match[0]);
    match = pattern.exec(text);
  }
  return paths;
}

function userBoundary(
  boundaryId: string,
  directive: ParsedDirective,
  kind: Boundary["kind"],
  severity: Boundary["severity"],
  overridable: boolean,
  appliesTo: Boundary["appliesTo"],
  now: string,
): Boundary {
  return {
    boundaryId,
    kind,
    severity,
    statement: directive.text,
    source: { type: "user_directive", confidence: 1, sourceSpan: directive.span },
    owner: "user",
    overridable,
    appliesTo,
    confidence: 1,
    status: "active",
    validFrom: now,
  };
}

// ── High-impact ambiguity detection (deterministic rules only) ──

const ORDERING_DIRECTIVE = /先([^，。,\n]{1,20}?)[，。,\s]*再([^，。,\n]{1,20}?)(?:[，。,\s]|$)/;
const METHOD_DIRECTIVE = /(?:使用|采用|借助)\s*([^，。,\n]{1,30}?)(?:编写|实现|开发|处理|分析|生成|运行)/;
const METHODOLOGICAL_GAP = /(?:由你决定|自行选择|方式不限|自行决定)/;

function normalizeSubject(text: string): string {
  return text.replace(/^(?:完成|开始|进行|执行|开展)\s*/, "").trim();
}

interface AmbiguityFindings {
  ambiguities: MaterialAmbiguity[];
  openBoundaries: Boundary[];
  sourceRefs: SourceRef[];
  assumptions: string[];
}

function openBoundary(
  boundaryId: string,
  kind: "objective" | "completion",
  statement: string,
  span: SourceSpan,
  now: string,
): Boundary {
  return {
    boundaryId,
    kind,
    severity: "open",
    statement,
    source: { type: "inferred", confidence: 1, sourceSpan: span },
    owner: "inferred",
    overridable: true,
    appliesTo: {},
    confidence: 1,
    status: "active",
    validFrom: now,
  };
}

function detectAmbiguities(
  parse: ParsedPrompt,
  deliverableCount: number,
  boundaryId: () => string,
  now: string,
): AmbiguityFindings {
  const findings: AmbiguityFindings = {
    ambiguities: [],
    openBoundaries: [],
    sourceRefs: [],
    assumptions: [],
  };

  // Conflicting 必须 directives: reversed explicit ordering, or two
  // directives mandating different named methods for the same activity.
  const musts = parse.musts;
  for (let i = 0; i < musts.length; i += 1) {
    const first = musts[i];
    if (first === undefined) continue;
    for (let j = i + 1; j < musts.length; j += 1) {
      const second = musts[j];
      if (second === undefined) continue;

      let conflict = false;
      const orderA = ORDERING_DIRECTIVE.exec(first.text);
      const orderB = ORDERING_DIRECTIVE.exec(second.text);
      const orderAFirst = orderA?.[1];
      const orderASecond = orderA?.[2];
      const orderBFirst = orderB?.[1];
      const orderBSecond = orderB?.[2];
      if (
        orderAFirst !== undefined &&
        orderASecond !== undefined &&
        orderBFirst !== undefined &&
        orderBSecond !== undefined
      ) {
        const firstSubject = normalizeSubject(orderAFirst);
        const firstTarget = normalizeSubject(orderASecond);
        const secondSubject = normalizeSubject(orderBFirst);
        const secondTarget = normalizeSubject(orderBSecond);
        if (
          firstSubject === secondTarget &&
          firstTarget === secondSubject &&
          firstSubject !== firstTarget
        ) {
          conflict = true;
        }
      }
      if (!conflict) {
        const methodA = METHOD_DIRECTIVE.exec(first.text)?.[1]?.trim();
        const methodB = METHOD_DIRECTIVE.exec(second.text)?.[1]?.trim();
        if (methodA !== undefined && methodB !== undefined && methodA !== methodB) {
          conflict = true;
        }
      }
      if (conflict) {
        const description = clip(
          `必须指令相互冲突：「${first.text}」与「${second.text}」`,
          1000,
        );
        const excerpt = clip(`${first.text}\n${second.text}`, 2000);
        const ambiguityId = deterministicId(
          `conflicting_directives:${first.span.start}:${first.span.end}:${second.span.start}:${second.span.end}`,
        );
        findings.ambiguities.push({
          ambiguityId,
          kind: "conflicting_directives",
          description,
          excerpt,
          sourceSpans: [first.span, second.span],
          decisionRequired: true,
        });
        const region: SourceSpan = {
          start: Math.min(first.span.start, second.span.start),
          end: Math.max(first.span.end, second.span.end),
        };
        findings.openBoundaries.push(
          openBoundary(boundaryId(), "objective", description, region, now),
        );
        findings.sourceRefs.push({ ref: "user-message", type: "user_message", excerpt });
      }
    }
  }

  // Stop conditions referencing deliverable numbers that were never declared.
  for (const stop of parse.stopConditions) {
    const reference = /交付物\s*(\d+)/g;
    let unclear = false;
    let match = reference.exec(stop.text);
    while (match !== null) {
      const number = Number(match[1]);
      if (Number.isInteger(number) && number > deliverableCount) {
        unclear = true;
        break;
      }
      match = reference.exec(stop.text);
    }
    if (unclear) {
      const description = clip(`停止条件引用了未声明的交付物：「${stop.text}」`, 1000);
      findings.ambiguities.push({
        ambiguityId: deterministicId(`completion_criteria_unclear:${stop.span.start}:${stop.span.end}`),
        kind: "completion_criteria_unclear",
        description,
        excerpt: clip(stop.text, 2000),
        sourceSpans: [stop.span],
        decisionRequired: true,
      });
      findings.openBoundaries.push(
        openBoundary(boundaryId(), "completion", description, stop.span, now),
      );
      findings.sourceRefs.push({ ref: "user-message", type: "user_message", excerpt: clip(stop.text, 2000) });
    }
  }

  // Methodological gaps are resolved by the executor, not by the user.
  for (const must of musts) {
    if (METHODOLOGICAL_GAP.test(must.text)) {
      findings.assumptions.push(`执行方需自行确定满足「${must.text}」的具体方式`);
    }
  }

  return findings;
}

// ── Deterministic content-derived identifiers ──

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function deterministicId(seed: string): string {
  const digest = createHash("sha256").update(seed, "utf8").digest();
  let value = 0;
  let bits = 0;
  let result = "";
  for (const byte of digest.subarray(0, 16)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_ALPHABET[(value >> bits) & 0x1f] ?? "0";
    }
  }
  if (bits > 0) result += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f] ?? "0";
  return result.slice(0, 26).padEnd(26, "0");
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  // If the cut lands on the low half of a surrogate pair, the slice would
  // end with its lone high half. Drop the pair so the result is always
  // well-formed UTF-16.
  if ((text.charCodeAt(end) & 0xfc00) === 0xdc00) end -= 1;
  return `${text.slice(0, end)}…`;
}

// ── Compilation pipeline ──

function validateInput(input: CompileContractInput): void {
  const invalid = (message: string): never => {
    throw new SestinaError(SestinaErrorCode.validation_failed, message);
  };
  if (!ProjectIdSchema.safeParse(input.projectId).success) {
    invalid("projectId must be a valid Sestina project id");
  }
  if (!TaskIdSchema.safeParse(input.taskId).success) {
    invalid("taskId must be a valid Sestina task id");
  }
  if (typeof input.title !== "string" || input.title.length === 0) {
    invalid("title must be a non-empty string");
  }
  if (input.title.length > 500) {
    invalid("title must be at most 500 characters");
  }
  if (typeof input.userPrompt !== "string") {
    invalid("userPrompt must be a string");
  }
  if (!TimestampSchema.safeParse(input.now).success) {
    invalid("now must be an ISO-8601 timestamp");
  }
}

const ESCALATION_CRITICAL = /(?:最高优先级|危急|最优先)/;
const ESCALATION_HIGH = /(?:优先|紧急|尽快|立即)/;
const RATIONALE_LINE = /^(?:理由|原因)\s*[:：]\s*(.+)$/m;
const SUCCESS_SIGNAL_LINE = /^(?:成功标准|完成标准|成功标志)\s*[:：]\s*(.+)$/m;
const EVIDENCE_WORDING = /(?:证据|证明|确认|验证|核实)/;

function compileContract(
  input: CompileContractInput,
  ports: ResolvedPorts,
): CompileContractDetailedResult {
  validateInput(input);
  const parse = parsePrompt(input.userPrompt);
  const template = resolveTemplate(input.templateId);

  if (parse.objective === undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "userPrompt does not contain a recognizable objective sentence",
    );
  }
  if (parse.objective.text.length > 2000) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "objective sentence exceeds 2000 characters",
    );
  }

  const mustText = parse.musts.map((must) => must.text).join("\n");
  let priority: Objective["priority"] = "normal";
  if (ESCALATION_CRITICAL.test(mustText)) priority = "critical";
  else if (ESCALATION_HIGH.test(mustText)) priority = "high";

  const objective: Objective = { primary: parse.objective.text, priority };
  const rationaleText = RATIONALE_LINE.exec(input.userPrompt)?.[1];
  if (rationaleText !== undefined) {
    objective.rationale = rationaleText.trim();
  }
  const successSignalText = SUCCESS_SIGNAL_LINE.exec(input.userPrompt)?.[1];
  if (successSignalText !== undefined) {
    objective.successSignal = successSignalText.trim();
  }

  const deliverables: Deliverable[] = parse.deliverables.map((directive) => ({
    deliverableId: ports.ids.deliverableId(),
    description: directive.text,
    acceptanceChecks: [],
    required: true,
    status: "not_started",
    evidenceRefs: [],
  }));

  const boundaries: Boundary[] = [];
  for (const must of parse.musts) {
    boundaries.push(
      userBoundary(ports.ids.boundaryId(), must, mustBoundaryKind(must.text), "soft", true, {}, input.now),
    );
  }
  for (const prohibition of parse.prohibitions) {
    const safetySense = SAFETY_SENSE.test(prohibition.text);
    boundaries.push(
      userBoundary(
        ports.ids.boundaryId(),
        prohibition,
        prohibitionBoundaryKind(prohibition.text),
        safetySense ? "hard" : "soft",
        !safetySense,
        {},
        input.now,
      ),
    );
  }
  for (const allowed of parse.allowOnly) {
    boundaries.push(
      userBoundary(
        ports.ids.boundaryId(),
        allowed,
        "scope",
        "hard",
        false,
        { paths: extractPaths(allowed.text) },
        input.now,
      ),
    );
  }

  const findings = detectAmbiguities(parse, deliverables.length, ports.ids.boundaryId, input.now);
  boundaries.push(...findings.openBoundaries);

  // Template defaults merge BELOW user facts.
  for (const templateBoundary of template?.defaults.boundaries ?? []) {
    boundaries.push({ ...templateBoundary, validFrom: input.now });
  }

  const scopeIn: ScopeItem[] = [];
  if (parse.deadline !== undefined) {
    scopeIn.push({
      statement: parse.deadline.statement,
      source: "user_directive",
      appliesTo: { timeRange: { end: parse.deadline.end } },
      sourceSpan: parse.deadline.span,
      readonly: true,
      writable: false,
      outbound: false,
      confidence: 1,
    });
  }

  const stopConditions = parse.stopConditions.map((stop) => ({
    condition: stop.text,
    isMet: false,
    evidenceRequired: EVIDENCE_WORDING.test(stop.text),
  }));

  const extractorRan = ports.semanticExtractor !== undefined;
  let notes = extractorRan ? "" : "Provider 未运行、语义可能不完整";
  if (parse.skipped > 0) {
    const suffix = `跳过无法解析的内容 ${parse.skipped} 处`;
    notes = notes === "" ? suffix : `${notes}；${suffix}`;
  }
  const semanticCompleteness: SemanticCompleteness = {
    semanticExtractorRan: extractorRan,
    completeness: extractorRan ? "provider_assisted" : "schema_valid_only",
    unknownFields: [],
    notes,
  };

  const sourceRefs: SourceRef[] = (input.userExcerpts ?? []).map((excerpt, index) => ({
    ref: `user-excerpt-${index}`,
    type: "user_message",
    excerpt,
  }));
  // Budget policy values are plain numbers and cannot carry spans; the
  // matched directive lines ride along as sourceRefs so the numbers stay
  // traceable to the prompt.
  sourceRefs.push(
    ...parse.budgetLines.map((line, index) => ({
      ref: `budget-directive-${index}`,
      type: "user_message" as const,
      excerpt: line.text,
    })),
  );
  sourceRefs.push(...findings.sourceRefs);

  const contract: TaskContract = {
    schemaVersion: "1.0.0",
    contractId: ports.ids.contractId() as ContractId,
    taskId: input.taskId as TaskId,
    version: 1,
    status: "draft",
    title: input.title,
    objective,
    deliverables,
    scope: { in: scopeIn, out: [] },
    boundaries,
    evidencePolicy: template?.defaults.evidencePolicy ?? DEFAULT_EVIDENCE_POLICY,
    authority: template?.defaults.authority ?? DEFAULT_AUTHORITY,
    budgets: { ...(template?.defaults.budgets ?? {}), ...parse.budget },
    stopConditions,
    assumptions: template?.defaults.assumptions ?? [],
    correctionRefs: [],
    sourceRefs,
    semanticCompleteness,
    createdAt: input.now,
    updatedAt: input.now,
  };

  try {
    TaskContractSchema.parse(contract);
  } catch (err) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "compiled contract failed schema validation",
      undefined,
      { issues: err instanceof Error ? err.message : String(err) },
    );
  }

  let extractorAmbiguities: MaterialAmbiguity[] = [];
  if (ports.semanticExtractor !== undefined) {
    const proposal = runSemanticExtractor(
      ports.semanticExtractor,
      { contract, sourceText: input.userPrompt, now: input.now },
      {
        maxInputChars: ports.maxExtractorInputChars,
        maxOutputBytes: ports.maxExtractorOutputBytes,
      },
    );
    if (proposal !== undefined) {
      extractorAmbiguities = proposal.ambiguities.filter((a) => a.decisionRequired);
    }
  }

  return {
    contract,
    ambiguities: [...findings.ambiguities, ...extractorAmbiguities],
    assumptions: findings.assumptions,
  };
}
