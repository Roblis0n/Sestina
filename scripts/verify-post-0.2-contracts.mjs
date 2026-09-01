#!/usr/bin/env node
/**
 * G0 contract-freeze verifier for the post-0.2 restructure contracts.
 *
 * Validates the machine-readable contract set under docs/product/restructure
 * and the two implementation records. Pure Node (no dependencies): parseable
 * by any Node >= 24 runtime and importable from the repository test suite.
 *
 * Usage:
 *   node scripts/verify-post-0.2-contracts.mjs
 *   node scripts/verify-post-0.2-contracts.mjs --repo-root <dir> --contracts-root <dir>
 *
 * Exit code 0 = all checks passed; any other exit code = failure.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── Check identifiers ────────────────────────────────────────────────────────
export const CHECKS = Object.freeze({
  REQUIRED_FILES: "required.files",
  JSON_PARSE: "json.parse",
  SCHEMA_VERSION: "json.schemaVersion",
  ID_UNIQUE: "json.idUnique",
  EFFECT_AUTHORITY: "effect.authority",
  EFFECT_PREREQUISITES: "effect.preconditions",
  EFFECT_REVISION: "effect.revisionRule",
  EFFECT_RECEIPT: "effect.receiptRule",
  EFFECT_TRACE: "effect.traceRule",
  EFFECT_DIRECT_CALL: "effect.externalDirectCall",
  REVIEW_UNKNOWN_STATE: "review.unknownState",
  REVIEW_TRANSITION_ACTOR: "review.transitionInitiator",
  REVIEW_ILLEGAL_LISTED: "review.illegalTransitions",
  REVIEW_TERMINAL_TRACE: "review.terminalTraceability",
  REVISION_INITIAL: "revision.initialValue",
  REVISION_INCREMENT: "revision.incrementRule",
  REVISION_NON_INCREMENT: "revision.nonIncrementRule",
  REVISION_CONCURRENCY: "revision.optimisticConcurrency",
  REVISION_BINDING: "revision.receiptTraceBinding",
  MANIFEST_IDENTITY: "manifest.identity",
  MANIFEST_ORDERING: "manifest.ordering",
  MANIFEST_CANONICALIZATION: "manifest.canonicalization",
  MANIFEST_HASH: "manifest.hashAlgorithm",
  MANIFEST_ENCODING: "manifest.encoding",
  MANIFEST_EXCLUSIONS: "manifest.excludedMutableFields",
  MANIFEST_PROVIDER: "manifest.providerMetadataBoundary",
  MANIFEST_CONSISTENCY: "manifest.previewPayloadConsistency",
  MANIFEST_REPLAY: "manifest.replayComparison",
  LEGACY_COVERAGE: "legacy.coverage",
  LEGACY_DISPOSITION: "legacy.disposition",
  LEGACY_AUTHORITY: "legacy.canonicalAuthority",
  ROUTES_PRIMARY: "routes.primaryEntries",
  ROUTE_OBJECTS: "routes.allowedDomainObjects",
  ROUTE_EFFECT: "routes.canFormCanonicalEffect",
  ROUTE_AUTHORITY: "routes.userAuthority",
  ROUTE_LEGACY_DISPOSAL: "routes.legacyDisposal",
  TERMINOLOGY_UNIQUE: "terminology.unique",
  TERMINOLOGY_FORBIDDEN_MIX: "terminology.forbiddenMixings",
  TERMINOLOGY_STATUS_WORDS: "terminology.statusWords",
  CV_SET: "cv.ids",
  CV_RESOLVED: "cv.unresolved",
  CV_STATUS: "cv.finalStatus",
  CV_EVIDENCE_EXISTS: "cv.evidencePathMissing",
  CV_EVIDENCE_RELATIVE: "cv.evidencePathNotRelative",
  ABSOLUTE_PATH: "path.absolute",
  FORBIDDEN_TOKEN: "placeholder",
  CROSS_EFFECT_REVISION: "cross.effectRevision",
  CROSS_REVIEW_EFFECT: "cross.reviewEffectKinds",
  CROSS_LEGACY_TERMS: "cross.legacyTerms",
  CROSS_ROUTE_LEGACY_PRIMARY: "cross.routeLegacyPrimary",
});

const {
  ABSOLUTE_PATH,
  CROSS_EFFECT_REVISION,
  CROSS_LEGACY_TERMS,
  CROSS_REVIEW_EFFECT,
  CROSS_ROUTE_LEGACY_PRIMARY,
  CV_EVIDENCE_EXISTS,
  CV_EVIDENCE_RELATIVE,
  CV_RESOLVED,
  CV_SET,
  CV_STATUS,
  EFFECT_AUTHORITY,
  EFFECT_DIRECT_CALL,
  EFFECT_PREREQUISITES,
  EFFECT_RECEIPT,
  EFFECT_REVISION,
  EFFECT_TRACE,
  FORBIDDEN_TOKEN,
  ID_UNIQUE,
  JSON_PARSE,
  LEGACY_AUTHORITY,
  LEGACY_COVERAGE,
  LEGACY_DISPOSITION,
  MANIFEST_CANONICALIZATION,
  MANIFEST_CONSISTENCY,
  MANIFEST_ENCODING,
  MANIFEST_EXCLUSIONS,
  MANIFEST_HASH,
  MANIFEST_IDENTITY,
  MANIFEST_ORDERING,
  MANIFEST_PROVIDER,
  MANIFEST_REPLAY,
  REQUIRED_FILES,
  REVISION_BINDING,
  REVISION_CONCURRENCY,
  REVISION_INCREMENT,
  REVISION_INITIAL,
  REVISION_NON_INCREMENT,
  REVIEW_ILLEGAL_LISTED,
  REVIEW_TERMINAL_TRACE,
  REVIEW_TRANSITION_ACTOR,
  REVIEW_UNKNOWN_STATE,
  ROUTE_AUTHORITY,
  ROUTE_EFFECT,
  ROUTE_LEGACY_DISPOSAL,
  ROUTE_OBJECTS,
  ROUTES_PRIMARY,
  SCHEMA_VERSION,
  TERMINOLOGY_FORBIDDEN_MIX,
  TERMINOLOGY_STATUS_WORDS,
  TERMINOLOGY_UNIQUE,
} = CHECKS;

const FAILED = Object.freeze({ ok: false });
const PASSED = Object.freeze({ ok: true });

function checkFailed(errors, check, message) {
  errors.push({ check, message });
  return FAILED;
}

// ── Input shape helpers ──────────────────────────────────────────────────────
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function asString(value) {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function requireString(errors, check, record, key, context) {
  const value = asString(record?.[key]);
  if (value === undefined || value.length === 0) {
    checkFailed(errors, check, `${context} is missing a non-empty "${key}".`);
    return undefined;
  }
  return value;
}

function requireStringArray(errors, check, record, key, context) {
  const value = asStringArray(record?.[key]);
  if (value === undefined || value.length === 0) {
    checkFailed(
      errors,
      check,
      `${context} is missing a non-empty string array "${key}".`,
    );
    return undefined;
  }
  return value;
}

// ── Contract set definition ──────────────────────────────────────────────────
export const CONTRACT_DIR = "contracts";

export const REQUIRED_CONTRACTS = Object.freeze([
  "01-canonical-effects.json",
  "02-review-lifecycle.json",
  "03-project-state-revision.json",
  "04-context-manifest-identity.json",
  "05-legacy-mapping.json",
  "06-route-map.json",
  "07-terminology.json",
  "08-requires-code-verification.json",
]);

export const REQUIRED_RECORDS = Object.freeze([
  "IMPLEMENTATION-DECISIONS.md",
  "IMPLEMENTATION-STATUS.md",
]);

/** All 15 concepts that the legacy mapping contract must cover. */
export const REQUIRED_LEGACY_CONCEPTS = Object.freeze([
  "room",
  "pilot",
  "episode",
  "issue",
  "decision",
  "evidence",
  "memory",
  "appeal",
  "review",
  "brief",
  "manifest",
  "agent-corrector",
  "mcp",
  "skill",
  "cli",
]);

export const REQUIRED_PRIMARY_ENTRIES = Object.freeze([
  "today-review",
  "project",
  "search",
  "settings",
]);

export const REQUIRED_CV_IDS = Object.freeze([
  "CV-01",
  "CV-02",
  "CV-03",
  "CV-04",
  "CV-05",
  "CV-06",
  "CV-07",
]);

export const ALLOWED_CV_STATUSES = Object.freeze([
  "verified_present",
  "verified_multiple",
  "verified_absent",
]);

export const ALLOWED_LEGACY_DISPOSITIONS = Object.freeze([
  "keep",
  "rename",
  "fold",
  "read_only",
  "archive",
  "delete",
  "keep_and_upgrade",
  "keep_and_refactor",
  "fold_into_review",
]);

export const CANONICAL_EFFECT_KINDS = Object.freeze([
  "record_only",
  "create_decision",
  "add_evidence",
  "create_or_resolve_issue",
  "patch_brief",
  "formal_direction_change",
]);

const FORBIDDEN_TOKENS = Object.freeze([
  ["TO", "DO"].join(""),
  ["T", "BD"].join(""),
  ["PLACE", "HOLDER"].join(""),
  ["T", "BC"].join(""),
  "待确认",
  "待补",
  "以后补",
  "以后处理",
  "后续补充",
  "后续实现",
]);

const FORBIDDEN_ABSOLUTE_PATH_PATTERNS = Object.freeze([
  { kind: "windows-drive", pattern: /^[A-Za-z]:[\\/]/u },
  { kind: "unc", pattern: /^\\\\/u },
  { kind: "unix-home", pattern: /(^|[\\/])(Users|home)([\\/])/u },
  { kind: "windows-users", pattern: /\\Users\\/u },
]);

const SCHEMA_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

// ── File loading ─────────────────────────────────────────────────────────────
function readJson(filePath, errors, check, context) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    checkFailed(errors, check, `${context} cannot be read: ${filePath}`);
    return undefined;
  }
  if (raw.charCodeAt(0) === 0xfeff) {
    checkFailed(
      errors,
      check,
      `${context} must be UTF-8 without a BOM: ${filePath}`,
    );
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    checkFailed(
      errors,
      check,
      `${context} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function collectStrings(value, strings, exemptKey, exempt = false) {
  if (typeof value === "string") {
    strings.push({ value, exempt });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings, exemptKey, exempt);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      collectStrings(item, strings, exemptKey, exempt || key === exemptKey);
    }
  }
}

function collectStringsWithExempt(value, exemptKey) {
  const strings = [];
  collectStrings(value, strings, exemptKey);
  return strings;
}

function scanStringsForViolations(errors, strings, context) {
  let failed = false;
  for (const entry of strings) {
    const { value, exempt } = entry;
    if (exempt) continue;
    for (const token of FORBIDDEN_TOKENS) {
      if (value.includes(token)) {
        checkFailed(
          errors,
          FORBIDDEN_TOKEN,
          `${context} contains the forbidden placeholder token "${token}": "${value.slice(0, 80)}"`,
        );
        failed = true;
      }
    }
    for (const rule of FORBIDDEN_ABSOLUTE_PATH_PATTERNS) {
      if (rule.pattern.test(value)) {
        checkFailed(
          errors,
          ABSOLUTE_PATH,
          `${context} contains a personal/absolute path pattern (${rule.kind}): "${value.slice(0, 80)}"`,
        );
        failed = true;
      }
    }
  }
  return failed;
}

// ── Individual contract validators ───────────────────────────────────────────
function validateCanonicalEffects(errors, doc) {
  const record = asRecord(doc);
  if (record === undefined) return;
  requireString(
    errors,
    SCHEMA_VERSION,
    record,
    "schemaVersion",
    "canonical-effects",
  );
  const effects = record.effects;
  if (
    !Array.isArray(effects) ||
    effects.length !== CANONICAL_EFFECT_KINDS.length
  ) {
    checkFailed(
      errors,
      EFFECT_AUTHORITY,
      "canonical-effects.effects must be an array of exactly the six frozen effect kinds.",
    );
    return;
  }
  const seenKinds = new Set();
  for (const effect of effects) {
    const entry = asRecord(effect);
    if (entry === undefined) {
      checkFailed(
        errors,
        EFFECT_AUTHORITY,
        "canonical-effects contains a non-object effect entry.",
      );
      continue;
    }
    const kind = asString(entry.effectKind);
    if (kind === undefined) {
      checkFailed(
        errors,
        EFFECT_AUTHORITY,
        "canonical-effects effect is missing effectKind.",
      );
      continue;
    }
    if (!CANONICAL_EFFECT_KINDS.includes(kind) || seenKinds.has(kind)) {
      checkFailed(
        errors,
        EFFECT_AUTHORITY,
        `canonical-effects has an unknown or duplicate effectKind: "${kind}".`,
      );
      continue;
    }
    seenKinds.add(kind);
    if (
      asString(entry.effectId) === undefined ||
      asString(entry.userVisibleName) === undefined
    ) {
      checkFailed(
        errors,
        EFFECT_AUTHORITY,
        `Effect ${kind} is missing effectId or userVisibleName.`,
      );
    }
    const authority = asString(entry.authority);
    if (authority === undefined || !authority.includes("user")) {
      checkFailed(
        errors,
        EFFECT_AUTHORITY,
        `Effect ${kind} must declare a user-only authority rule; got "${authority ?? "missing"}".`,
      );
    }
    requireStringArray(
      errors,
      EFFECT_PREREQUISITES,
      entry,
      "preconditions",
      `Effect ${kind}`,
    );
    requireStringArray(
      errors,
      EFFECT_REVISION,
      entry,
      "revisionPreconditions",
      `Effect ${kind}`,
    );
    requireStringArray(
      errors,
      EFFECT_RECEIPT,
      entry,
      "receiptRequirements",
      `Effect ${kind}`,
    );
    requireStringArray(
      errors,
      EFFECT_TRACE,
      entry,
      "traceRequirements",
      `Effect ${kind}`,
    );
    if (entry.externalDirectCallable !== false) {
      checkFailed(
        errors,
        EFFECT_DIRECT_CALL,
        `Effect ${kind} must set externalDirectCallable=false (external interfaces may never invoke an effect directly).`,
      );
    }
    requireString(
      errors,
      EFFECT_PREREQUISITES,
      entry,
      "failureSemantics",
      `Effect ${kind}`,
    );
    requireString(
      errors,
      EFFECT_PREREQUISITES,
      entry,
      "idempotencySemantics",
      `Effect ${kind}`,
    );
  }
  const common = asRecord(record.commonInvariants);
  if (common !== undefined) {
    if (
      asString(common.authorityRule) === undefined ||
      !asString(common.authorityRule).includes("user")
    ) {
      checkFailed(
        errors,
        EFFECT_AUTHORITY,
        "canonical-effects.commonInvariants must declare the user-only authority rule.",
      );
    }
    if (
      asString(common.atomicityRule) === undefined ||
      !asString(common.atomicityRule).includes("atomic")
    ) {
      checkFailed(
        errors,
        EFFECT_RECEIPT,
        "canonical-effects.commonInvariants must declare all-or-nothing atomic mutation with Receipt/Trace in the same transaction.",
      );
    }
  }
  const command = asRecord(record.authorityCommand);
  if (command !== undefined) {
    if (
      asString(command.idempotencyKey) === undefined ||
      asString(command.actorRequirement) === undefined ||
      command.actorRequirement !== "user_only"
    ) {
      checkFailed(
        errors,
        EFFECT_DIRECT_CALL,
        "canonical-effects.authorityCommand must bind an idempotency key to a user_only actor requirement.",
      );
    }
  }
}

function validateReviewLifecycle(errors, doc) {
  const record = asRecord(doc);
  if (record === undefined) return;
  requireString(
    errors,
    SCHEMA_VERSION,
    record,
    "schemaVersion",
    "review-lifecycle",
  );
  const states = requireStringArray(
    errors,
    REVIEW_UNKNOWN_STATE,
    record,
    "states",
    "review-lifecycle",
  );
  if (states === undefined) return;
  const stateSet = new Set(states);
  if (stateSet.size !== states.length) {
    checkFailed(
      errors,
      REVIEW_UNKNOWN_STATE,
      "review-lifecycle.states contains duplicates.",
    );
  }
  const transitions = record.transitions;
  if (!Array.isArray(transitions) || transitions.length === 0) {
    checkFailed(
      errors,
      REVIEW_UNKNOWN_STATE,
      "review-lifecycle.transitions must be a non-empty array.",
    );
    return;
  }
  for (const transition of transitions) {
    const entry = asRecord(transition);
    if (entry === undefined) {
      checkFailed(
        errors,
        REVIEW_UNKNOWN_STATE,
        "review-lifecycle has a non-object transition.",
      );
      continue;
    }
    for (const key of ["from", "to"]) {
      const value = asString(entry[key]);
      if (value === undefined || !stateSet.has(value)) {
        checkFailed(
          errors,
          REVIEW_UNKNOWN_STATE,
          `review-lifecycle transition references unknown state "${value ?? "missing"}" in "${key}".`,
        );
      }
    }
    if (asString(entry.initiator) === undefined) {
      checkFailed(
        errors,
        REVIEW_TRANSITION_ACTOR,
        `review-lifecycle transition ${entry.from ?? "?"} -> ${entry.to ?? "?"} is missing its initiator.`,
      );
    }
    if (entry.requiresUserAdjudication === undefined) {
      checkFailed(
        errors,
        REVIEW_TRANSITION_ACTOR,
        `review-lifecycle transition ${entry.from ?? "?"} -> ${entry.to ?? "?"} is missing requiresUserAdjudication.`,
      );
    }
  }
  const illegal = record.illegalTransitions;
  if (!Array.isArray(illegal) || illegal.length === 0) {
    checkFailed(
      errors,
      REVIEW_ILLEGAL_LISTED,
      "review-lifecycle must explicitly list illegalTransitions (state-machine states may never be free-form string combinations).",
    );
  } else {
    for (const transition of illegal) {
      const entry = asRecord(transition);
      if (entry === undefined) continue;
      if (
        asString(entry.from) === undefined ||
        asString(entry.to) === undefined ||
        asString(entry.reason) === undefined
      ) {
        checkFailed(
          errors,
          REVIEW_ILLEGAL_LISTED,
          "review-lifecycle illegalTransitions entries require from, to and reason.",
        );
      }
      const legalPair = transitions.some(
        (legal) =>
          asRecord(legal)?.from === entry.from &&
          asRecord(legal)?.to === entry.to,
      );
      const conditionalProhibition = asString(entry.condition);
      if (legalPair && conditionalProhibition === undefined) {
        checkFailed(
          errors,
          REVIEW_ILLEGAL_LISTED,
          `review-lifecycle transition ${entry.from} -> ${entry.to} is listed as both legal and illegal.`,
        );
      }
    }
  }
  const terminalStates = requireStringArray(
    errors,
    REVIEW_TERMINAL_TRACE,
    record,
    "terminalStates",
    "review-lifecycle",
  );
  if (terminalStates !== undefined) {
    for (const state of terminalStates) {
      if (!stateSet.has(state)) {
        checkFailed(
          errors,
          REVIEW_TERMINAL_TRACE,
          `review-lifecycle terminalStates references unknown state "${state}".`,
        );
      }
    }
    const traceable = asString(record.terminalTraceability);
    if (traceable === undefined || traceable.length === 0) {
      checkFailed(
        errors,
        REVIEW_TERMINAL_TRACE,
        "review-lifecycle must declare terminalTraceability (terminal states stay traceable via Receipt/History).",
      );
    }
  }
  if (asString(record.recoverySemantics) === undefined) {
    checkFailed(
      errors,
      REVIEW_UNKNOWN_STATE,
      "review-lifecycle must declare recoverySemantics.",
    );
  }
  if (
    asString(record.correctionSemantics) === undefined ||
    asString(record.reopenSemantics) === undefined
  ) {
    checkFailed(
      errors,
      REVIEW_UNKNOWN_STATE,
      "review-lifecycle must declare correctionSemantics and reopenSemantics.",
    );
  }
  const effectKinds = asStringArray(record.committableEffectKinds);
  if (effectKinds === undefined) {
    checkFailed(
      errors,
      CROSS_REVIEW_EFFECT,
      "review-lifecycle must declare committableEffectKinds.",
    );
  } else {
    for (const kind of effectKinds) {
      if (!CANONICAL_EFFECT_KINDS.includes(kind)) {
        checkFailed(
          errors,
          CROSS_REVIEW_EFFECT,
          `review-lifecycle committableEffectKinds references unknown effect kind "${kind}".`,
        );
      }
    }
    for (const kind of CANONICAL_EFFECT_KINDS) {
      if (!effectKinds.includes(kind)) {
        checkFailed(
          errors,
          CROSS_REVIEW_EFFECT,
          `review-lifecycle committableEffectKinds is missing canonical effect kind "${kind}".`,
        );
      }
    }
  }
}

function validateRevision(errors, doc) {
  const record = asRecord(doc);
  if (record === undefined) return;
  requireString(
    errors,
    SCHEMA_VERSION,
    record,
    "schemaVersion",
    "project-state-revision",
  );
  const initial = asString(record.initialValue);
  if (initial === undefined || !initial.includes("1")) {
    checkFailed(
      errors,
      REVISION_INITIAL,
      "project-state-revision.initialValue must define the migration baseline revision 1 (no fabricated history).",
    );
  }
  const increments = asRecord(record.increments);
  if (increments === undefined) {
    checkFailed(
      errors,
      REVISION_INCREMENT,
      "project-state-revision.increments is missing.",
    );
    return;
  }
  for (const kind of CANONICAL_EFFECT_KINDS) {
    if (
      !Object.prototype.hasOwnProperty.call(increments, kind) ||
      asString(increments[kind]) === undefined
    ) {
      checkFailed(
        errors,
        CROSS_EFFECT_REVISION,
        `project-state-revision.increments is missing a rule for canonical effect kind "${kind}".`,
      );
    }
  }
  for (const key of [
    "memory_governance_change",
    "compensation",
    "migration_baseline",
    "record_only_outcome",
  ]) {
    if (asString(increments[key]) === undefined) {
      checkFailed(
        errors,
        REVISION_INCREMENT,
        `project-state-revision.increments is missing "${key}".`,
      );
    }
  }
  const nonIncrements = requireStringArray(
    errors,
    REVISION_NON_INCREMENT,
    record,
    "nonIncrements",
    "project-state-revision",
  );
  if (nonIncrements !== undefined) {
    for (const key of [
      "review_draft",
      "manifest",
      "provider_attempt",
      "provider_assessment",
      "correction",
      "second_opinion",
      "host_draft",
      "provider_settings",
      "ui_preferences",
      "derived_projection_rebuild",
      "backup_export",
    ]) {
      if (!nonIncrements.includes(key)) {
        checkFailed(
          errors,
          REVISION_NON_INCREMENT,
          `project-state-revision.nonIncrements is missing "${key}".`,
        );
      }
    }
  }
  if (
    asString(record.optimisticConcurrency) === undefined ||
    asString(record.conflictBehavior) === undefined ||
    asString(record.failureRevisionBehavior) === undefined
  ) {
    checkFailed(
      errors,
      REVISION_CONCURRENCY,
      "project-state-revision must declare optimisticConcurrency, conflictBehavior and failureRevisionBehavior.",
    );
  }
  const binding = asRecord(record.receiptTraceBinding);
  if (
    binding === undefined ||
    asString(binding.receipt) === undefined ||
    asString(binding.trace) === undefined ||
    binding.sameTransaction !== true ||
    asString(binding.recoveryRule) === undefined
  ) {
    checkFailed(
      errors,
      REVISION_BINDING,
      "project-state-revision.receiptTraceBinding must bind Receipt and Trace to the revision in the same transaction and declare the recovery rule.",
    );
  }
  if (record.monotonic !== true || record.neverDecreases !== true) {
    checkFailed(
      errors,
      REVISION_INCREMENT,
      "project-state-revision must freeze monotonic=true and neverDecreases=true.",
    );
  }
}

function validateManifest(errors, doc) {
  const record = asRecord(doc);
  if (record === undefined) return;
  requireString(
    errors,
    SCHEMA_VERSION,
    record,
    "schemaVersion",
    "context-manifest-identity",
  );
  const identity = asRecord(record.identity);
  if (identity === undefined) {
    checkFailed(
      errors,
      MANIFEST_IDENTITY,
      "context-manifest-identity.identity is missing.",
    );
    return;
  }
  for (const key of [
    "projectId",
    "projectStateRevision",
    "contextPolicyVersion",
    "contextProjectionSchemaVersion",
    "contextProjectionHash",
    "exactRequestHash",
    "exactRequestBody",
    "exactRequestBytes",
  ]) {
    if (
      !Object.prototype.hasOwnProperty.call(identity, key) ||
      asString(identity[key]) === undefined
    ) {
      checkFailed(
        errors,
        MANIFEST_IDENTITY,
        `context-manifest-identity.identity is missing "${key}".`,
      );
    }
  }
  requireStringArray(
    errors,
    MANIFEST_ORDERING,
    record,
    "objectSelection",
    "context-manifest-identity",
  );
  const ordering = requireStringArray(
    errors,
    MANIFEST_ORDERING,
    record,
    "ordering",
    "context-manifest-identity",
  );
  if (
    ordering !== undefined &&
    !ordering.some((item) => item.includes("deterministic"))
  ) {
    checkFailed(
      errors,
      MANIFEST_ORDERING,
      "context-manifest-identity.ordering must define a deterministic order.",
    );
  }
  const canonicalization = requireString(
    errors,
    MANIFEST_CANONICALIZATION,
    record,
    "canonicalization",
    "context-manifest-identity",
  );
  if (
    canonicalization !== undefined &&
    !/sort|canonical/i.test(canonicalization)
  ) {
    checkFailed(
      errors,
      MANIFEST_CANONICALIZATION,
      "context-manifest-identity.canonicalization must define canonical key ordering.",
    );
  }
  const hashAlgorithm = requireString(
    errors,
    MANIFEST_HASH,
    record,
    "hashAlgorithm",
    "context-manifest-identity",
  );
  if (
    hashAlgorithm !== undefined &&
    !hashAlgorithm.toUpperCase().includes("SHA-256")
  ) {
    checkFailed(
      errors,
      MANIFEST_HASH,
      "context-manifest-identity.hashAlgorithm must be SHA-256.",
    );
  }
  if (
    asString(record.encoding) === undefined ||
    !record.encoding.toUpperCase().includes("UTF-8")
  ) {
    checkFailed(
      errors,
      MANIFEST_ENCODING,
      "context-manifest-identity.encoding must be UTF-8.",
    );
  }
  requireStringArray(
    errors,
    MANIFEST_EXCLUSIONS,
    record,
    "excludedMutableFields",
    "context-manifest-identity",
  );
  const provider = asString(record.providerMetadataBoundary);
  if (
    provider === undefined ||
    !/secrets?/iu.test(provider) ||
    !/hidden reasoning/iu.test(provider)
  ) {
    checkFailed(
      errors,
      MANIFEST_PROVIDER,
      "context-manifest-identity.providerMetadataBoundary must exclude secrets and hidden reasoning.",
    );
  }
  const consistency = asString(record.previewPayloadConsistency);
  if (consistency === undefined || !consistency.includes("exactRequestHash")) {
    checkFailed(
      errors,
      MANIFEST_CONSISTENCY,
      "context-manifest-identity.previewPayloadConsistency must bind preview and payload by exactRequestHash equality.",
    );
  }
  const replay = asString(record.replayComparison);
  if (
    replay === undefined ||
    !/before (any )?network/iu.test(replay) ||
    !/mismatch/iu.test(replay) ||
    !/(fail(?:s|ed)? closed|zero network)/iu.test(replay)
  ) {
    checkFailed(
      errors,
      MANIFEST_REPLAY,
      "context-manifest-identity.replayComparison must revalidate before network and fail closed on any mismatch.",
    );
  }
}

function validateLegacyMapping(errors, doc) {
  const record = asRecord(doc);
  if (record === undefined) return;
  requireString(
    errors,
    SCHEMA_VERSION,
    record,
    "schemaVersion",
    "legacy-mapping",
  );
  const concepts = record.concepts;
  if (!Array.isArray(concepts)) {
    checkFailed(
      errors,
      LEGACY_COVERAGE,
      "legacy-mapping.concepts must be an array.",
    );
    return;
  }
  const ids = new Set();
  for (const concept of concepts) {
    const entry = asRecord(concept);
    if (entry === undefined) continue;
    const id = asString(entry.id);
    if (id === undefined || ids.has(id)) {
      checkFailed(
        errors,
        LEGACY_COVERAGE,
        "legacy-mapping concepts must have unique ids.",
      );
      continue;
    }
    ids.add(id);
    if (
      asString(entry.currentMeaning) === undefined ||
      asString(entry.targetMeaning) === undefined
    ) {
      checkFailed(
        errors,
        LEGACY_COVERAGE,
        `legacy-mapping concept ${id} is missing currentMeaning or targetMeaning.`,
      );
    }
    const disposition = asString(entry.disposition);
    if (
      disposition === undefined ||
      !ALLOWED_LEGACY_DISPOSITIONS.includes(disposition)
    ) {
      checkFailed(
        errors,
        LEGACY_DISPOSITION,
        `legacy-mapping concept ${id} has an unknown disposition "${disposition ?? "missing"}".`,
      );
    }
    if (typeof entry.canonicalAuthority !== "boolean") {
      checkFailed(
        errors,
        LEGACY_AUTHORITY,
        `legacy-mapping concept ${id} must declare canonicalAuthority as a boolean.`,
      );
    }
    if (
      asString(entry.compatibilityWindow) === undefined ||
      asString(entry.migrationGate) === undefined
    ) {
      checkFailed(
        errors,
        LEGACY_DISPOSITION,
        `legacy-mapping concept ${id} is missing compatibilityWindow or migrationGate.`,
      );
    }
  }
  for (const required of REQUIRED_LEGACY_CONCEPTS) {
    if (!ids.has(required)) {
      checkFailed(
        errors,
        LEGACY_COVERAGE,
        `legacy-mapping is missing the required concept "${required}".`,
      );
    }
  }
  const authorityRule = asString(record.authorityRule);
  if (authorityRule === undefined || !authorityRule.includes("user")) {
    checkFailed(
      errors,
      LEGACY_AUTHORITY,
      "legacy-mapping must declare that no legacy concept may carry canonical authority except user-owned canonical objects.",
    );
  }
}

function validateRoutes(errors, doc) {
  const record = asRecord(doc);
  if (record === undefined) return;
  requireString(errors, SCHEMA_VERSION, record, "schemaVersion", "route-map");
  const primary = asStringArray(record.primaryEntries);
  if (primary === undefined) {
    checkFailed(
      errors,
      ROUTES_PRIMARY,
      "route-map.primaryEntries must be a string array.",
    );
    return;
  }
  for (const required of REQUIRED_PRIMARY_ENTRIES) {
    if (!primary.includes(required)) {
      checkFailed(
        errors,
        ROUTES_PRIMARY,
        `route-map.primaryEntries is missing "${required}".`,
      );
    }
  }
  const routes = record.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    checkFailed(
      errors,
      ROUTE_OBJECTS,
      "route-map.routes must be a non-empty array.",
    );
    return;
  }
  const routeIds = new Set();
  for (const route of routes) {
    const entry = asRecord(route);
    if (entry === undefined) continue;
    const id = asString(entry.route);
    if (id === undefined || routeIds.has(id)) {
      checkFailed(
        errors,
        ROUTE_OBJECTS,
        "route-map routes must have unique route ids.",
      );
      continue;
    }
    routeIds.add(id);
    requireStringArray(
      errors,
      ROUTE_OBJECTS,
      entry,
      "allowedDomainObjects",
      `Route ${id}`,
    );
    if (typeof entry.canFormCanonicalEffect !== "boolean") {
      checkFailed(
        errors,
        ROUTE_EFFECT,
        `Route ${id} must declare canFormCanonicalEffect as a boolean.`,
      );
    }
    if (asString(entry.userAuthoritySurface) === undefined) {
      checkFailed(
        errors,
        ROUTE_AUTHORITY,
        `Route ${id} must declare where user Authority appears (userAuthoritySurface).`,
      );
    }
  }
  const legacy = record.legacyRouteDisposal;
  if (!Array.isArray(legacy)) {
    checkFailed(
      errors,
      ROUTE_LEGACY_DISPOSAL,
      "route-map.legacyRouteDisposal must be an array.",
    );
    return;
  }
  for (const entryValue of legacy) {
    const entry = asRecord(entryValue);
    if (entry === undefined) continue;
    const route = asString(entry.route);
    const disposal = asString(entry.disposal);
    if (route === undefined || disposal === undefined) {
      checkFailed(
        errors,
        ROUTE_LEGACY_DISPOSAL,
        "route-map.legacyRouteDisposal entries require route and disposal.",
      );
      continue;
    }
    if (routeIds.has(route)) {
      checkFailed(
        errors,
        CROSS_ROUTE_LEGACY_PRIMARY,
        `route-map legacy route "${route}" conflicts with an active route.`,
      );
    }
    if (!/read|redirect|410|404|archive|alias/i.test(disposal)) {
      checkFailed(
        errors,
        ROUTE_LEGACY_DISPOSAL,
        `route-map legacy route "${route}" has a disposal that keeps no write path: "${disposal}".`,
      );
    }
  }
  if (
    asString(record.recoveryEntry) === undefined ||
    asString(record.errorDegradation) === undefined
  ) {
    checkFailed(
      errors,
      ROUTE_PRIMARY,
      "route-map must declare recoveryEntry and errorDegradation surfaces.",
    );
  }
}

function validateTerminology(errors, doc) {
  const record = asRecord(doc);
  if (record === undefined) return;
  requireString(errors, SCHEMA_VERSION, record, "schemaVersion", "terminology");
  const terms = record.terms;
  if (!Array.isArray(terms) || terms.length === 0) {
    checkFailed(
      errors,
      TERMINOLOGY_UNIQUE,
      "terminology.terms must be a non-empty array.",
    );
    return;
  }
  const ids = new Set();
  for (const term of terms) {
    const entry = asRecord(term);
    if (entry === undefined) continue;
    const id = asString(entry.id);
    if (id === undefined || ids.has(id)) {
      checkFailed(
        errors,
        TERMINOLOGY_UNIQUE,
        `terminology term has a missing or duplicate id "${id ?? "missing"}".`,
      );
      continue;
    }
    ids.add(id);
    if (asString(entry.definition) === undefined) {
      checkFailed(
        errors,
        TERMINOLOGY_UNIQUE,
        `terminology term ${id} is missing its definition.`,
      );
    }
  }
  const legacy = asStringArray(record.legacyTerms);
  if (legacy === undefined || legacy.length === 0) {
    checkFailed(
      errors,
      TERMINOLOGY_FORBIDDEN_MIX,
      "terminology.legacyTerms must be a non-empty array.",
    );
  }
  const mixings = record.forbiddenMixings;
  if (!Array.isArray(mixings) || mixings.length === 0) {
    checkFailed(
      errors,
      TERMINOLOGY_FORBIDDEN_MIX,
      "terminology.forbiddenMixings must be a non-empty array.",
    );
  } else {
    for (const mixing of mixings) {
      const entry = asRecord(mixing);
      if (entry === undefined || asString(entry.rule) === undefined) {
        checkFailed(
          errors,
          TERMINOLOGY_FORBIDDEN_MIX,
          "terminology.forbiddenMixings entries require a rule.",
        );
      }
    }
  }
  const statusWords = record.statusWords;
  if (!Array.isArray(statusWords) || statusWords.length === 0) {
    checkFailed(
      errors,
      TERMINOLOGY_STATUS_WORDS,
      "terminology.statusWords must be a non-empty array.",
    );
  } else {
    for (const word of statusWords) {
      const entry = asRecord(word);
      if (
        entry === undefined ||
        asString(entry.word) === undefined ||
        asString(entry.usageCondition) === undefined
      ) {
        checkFailed(
          errors,
          TERMINOLOGY_STATUS_WORDS,
          "terminology.statusWords entries require word and usageCondition.",
        );
      }
    }
  }
  const overclaims = asStringArray(record.forbiddenOverclaims);
  if (overclaims === undefined || overclaims.length === 0) {
    checkFailed(
      errors,
      TERMINOLOGY_FORBIDDEN_MIX,
      "terminology.forbiddenOverclaims must be a non-empty array.",
    );
  }
}

function validateCodeVerification(errors, doc, repoRoot) {
  const record = asRecord(doc);
  if (record === undefined) return;
  requireString(
    errors,
    SCHEMA_VERSION,
    record,
    "schemaVersion",
    "requires-code-verification",
  );
  const items = record.items;
  if (!Array.isArray(items)) {
    checkFailed(
      errors,
      CV_SET,
      "requires-code-verification.items must be an array.",
    );
    return;
  }
  const ids = new Set(
    items
      .map((item) => asString(asRecord(item)?.id))
      .filter((id) => id !== undefined),
  );
  if (items.length !== 7 || ids.size !== 7) {
    checkFailed(
      errors,
      CV_SET,
      "requires-code-verification must contain exactly 7 items with unique ids.",
    );
  }
  for (const required of REQUIRED_CV_IDS) {
    if (!ids.has(required)) {
      checkFailed(
        errors,
        CV_SET,
        `requires-code-verification is missing "${required}".`,
      );
    }
  }
  for (const item of items) {
    const entry = asRecord(item);
    if (entry === undefined) continue;
    const id = asString(entry.id);
    if (entry.unresolved !== false) {
      checkFailed(
        errors,
        CV_RESOLVED,
        `${id ?? "CV item"} must set unresolved=false.`,
      );
    }
    const status = asString(entry.finalStatus);
    if (status === undefined || !ALLOWED_CV_STATUSES.includes(status)) {
      checkFailed(
        errors,
        CV_STATUS,
        `${id ?? "CV item"} finalStatus must be one of verified_present, verified_multiple, verified_absent.`,
      );
    }
    for (const key of [
      "question",
      "currentImplementationConclusion",
      "targetRequirement",
      "g1Impact",
      "reviewDate",
      "baselineCommit",
    ]) {
      if (asString(entry[key]) === undefined) {
        checkFailed(errors, CV_SET, `${id ?? "CV item"} is missing "${key}".`);
      }
    }
    if (
      typeof entry.hasSecurityRisk !== "boolean" ||
      typeof entry.hasUnknownItems !== "boolean"
    ) {
      checkFailed(
        errors,
        CV_SET,
        `${id ?? "CV item"} must declare hasSecurityRisk and hasUnknownItems as booleans.`,
      );
    }
    const evidence = entry.evidence;
    if (!Array.isArray(evidence) || evidence.length === 0) {
      checkFailed(
        errors,
        CV_EVIDENCE_EXISTS,
        `${id ?? "CV item"} must carry a non-empty evidence array.`,
      );
      continue;
    }
    for (const entryValue of evidence) {
      const evidenceEntry = asRecord(entryValue);
      if (evidenceEntry === undefined) continue;
      const path = asString(evidenceEntry.path);
      const type = asString(evidenceEntry.type);
      if (
        path === undefined ||
        type === undefined ||
        asString(evidenceEntry.symbol) === undefined
      ) {
        checkFailed(
          errors,
          CV_EVIDENCE_EXISTS,
          `${id ?? "CV item"} evidence entries require path, type and symbol.`,
        );
        continue;
      }
      if (isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path)) {
        checkFailed(
          errors,
          CV_EVIDENCE_RELATIVE,
          `${id ?? "CV item"} evidence path must be repo-relative: "${path}".`,
        );
        continue;
      }
      if (path.split(/[\\/]/u).includes("..")) {
        checkFailed(
          errors,
          CV_EVIDENCE_RELATIVE,
          `${id ?? "CV item"} evidence path must not escape the repository: "${path}".`,
        );
        continue;
      }
      const fullPath = join(repoRoot, path);
      if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
        checkFailed(
          errors,
          CV_EVIDENCE_EXISTS,
          `${id ?? "CV item"} evidence path does not exist in the repository: "${path}".`,
        );
      }
    }
  }
}

// ── Main validation entry ────────────────────────────────────────────────────
export function validateContracts(options = {}) {
  const repoRoot = resolve(
    options.repoRoot ?? dirname(dirname(fileURLToPath(import.meta.url))),
  );
  const contractsRoot = resolve(
    options.contractsRoot ?? join(repoRoot, "docs", "product", "restructure"),
  );
  const errors = [];
  const summary = { contracts: [], checksPassed: 0, checksFailed: 0 };

  for (const file of REQUIRED_RECORDS) {
    const fullPath = join(contractsRoot, file);
    if (!existsSync(fullPath)) {
      checkFailed(
        errors,
        REQUIRED_FILES,
        `Required implementation record is missing: docs/product/restructure/${file}`,
      );
      continue;
    }
    let raw;
    try {
      raw = readFileSync(fullPath, "utf8");
    } catch {
      checkFailed(
        errors,
        REQUIRED_FILES,
        `Required implementation record cannot be read: docs/product/restructure/${file}`,
      );
      continue;
    }
    const strings = [{ value: raw, exempt: false }];
    scanStringsForViolations(
      errors,
      strings,
      `docs/product/restructure/${file}`,
    );
    summary.contracts.push(file);
  }

  const contractDir = join(contractsRoot, CONTRACT_DIR);
  if (!existsSync(contractDir)) {
    checkFailed(
      errors,
      REQUIRED_FILES,
      `Contract directory is missing: docs/product/restructure/${CONTRACT_DIR}`,
    );
  } else {
    for (const file of REQUIRED_CONTRACTS) {
      const fullPath = join(contractDir, file);
      if (!existsSync(fullPath)) {
        checkFailed(
          errors,
          REQUIRED_FILES,
          `Required contract is missing: docs/product/restructure/${CONTRACT_DIR}/${file}`,
        );
        continue;
      }
      summary.contracts.push(file);
      const doc = readJson(
        fullPath,
        errors,
        JSON_PARSE,
        `${CONTRACT_DIR}/${file}`,
      );
      if (doc === undefined) continue;
      const strings = collectStringsWithExempt(
        doc,
        "forbiddenPlaceholderTokens",
      );
      scanStringsForViolations(errors, strings, `${CONTRACT_DIR}/${file}`);
      switch (file) {
        case "01-canonical-effects.json":
          validateCanonicalEffects(errors, doc);
          break;
        case "02-review-lifecycle.json":
          validateReviewLifecycle(errors, doc);
          break;
        case "03-project-state-revision.json":
          validateRevision(errors, doc);
          break;
        case "04-context-manifest-identity.json":
          validateManifest(errors, doc);
          break;
        case "05-legacy-mapping.json":
          validateLegacyMapping(errors, doc);
          break;
        case "06-route-map.json":
          validateRoutes(errors, doc);
          break;
        case "07-terminology.json":
          validateTerminology(errors, doc);
          break;
        case "08-requires-code-verification.json":
          validateCodeVerification(errors, doc, repoRoot);
          break;
        default:
          break;
      }
    }
  }

  // All parsed JSON files must carry a schemaVersion.
  const parsedDocs = [];
  for (const file of REQUIRED_CONTRACTS) {
    const fullPath = join(contractDir, file);
    if (!existsSync(fullPath)) continue;
    const doc = readJson(fullPath, [], JSON_PARSE, `${CONTRACT_DIR}/${file}`);
    if (doc === undefined) continue;
    const record = asRecord(doc);
    const version = asString(record?.schemaVersion);
    if (version === undefined || !SCHEMA_VERSION_PATTERN.test(version)) {
      checkFailed(
        errors,
        SCHEMA_VERSION,
        `${CONTRACT_DIR}/${file} must carry a schemaVersion matching x.y.z.`,
      );
    }
    const id = asString(record?.id);
    if (id !== undefined) parsedDocs.push({ file, id });
  }
  const seenIds = new Set();
  for (const entry of parsedDocs) {
    if (seenIds.has(entry.id)) {
      checkFailed(
        errors,
        ID_UNIQUE,
        `Duplicate contract id "${entry.id}" in ${entry.file}.`,
      );
    }
    seenIds.add(entry.id);
  }

  // Cross-contract: legacy concepts must each have a terminology entry.
  const legacyPath = join(contractDir, "05-legacy-mapping.json");
  const terminologyPath = join(contractDir, "07-terminology.json");
  if (existsSync(legacyPath) && existsSync(terminologyPath)) {
    const legacyDoc = readJson(
      legacyPath,
      [],
      JSON_PARSE,
      "05-legacy-mapping.json",
    );
    const termsDoc = readJson(
      terminologyPath,
      [],
      JSON_PARSE,
      "07-terminology.json",
    );
    const concepts = Array.isArray(legacyDoc?.concepts)
      ? legacyDoc.concepts
          .map((item) => asString(asRecord(item)?.id))
          .filter((id) => id !== undefined)
      : [];
    const termIds = new Set(
      Array.isArray(termsDoc?.terms)
        ? termsDoc.terms
            .map((item) => asString(asRecord(item)?.id))
            .filter((id) => id !== undefined)
        : [],
    );
    for (const concept of concepts) {
      if (!termIds.has(concept)) {
        checkFailed(
          errors,
          CROSS_LEGACY_TERMS,
          `legacy-mapping concept "${concept}" has no matching entry in terminology.terms.`,
        );
      }
    }
  }

  const uniqueChecks = new Set(errors.map((error) => error.check));
  const failed = errors.length > 0;
  const result = {
    ok: !failed,
    repoRoot,
    contractsRoot,
    errors,
    summary: {
      ...summary,
      failedCheckKinds: [...uniqueChecks],
      verdict: failed ? "FAILED" : "PASSED",
    },
  };
  return result;
}

export function formatVerificationResult(result) {
  const lines = [];
  lines.push("post-0.2 contract verification");
  lines.push(`  repo-root     : ${result.repoRoot}`);
  lines.push(`  contracts-root: ${result.contractsRoot}`);
  lines.push(
    `  contracts     : ${result.summary.contracts.length} files loaded`,
  );
  if (result.ok) {
    lines.push(`  verdict       : PASSED`);
    lines.push(
      "  all structural, cross-reference, evidence-path, placeholder and path checks passed.",
    );
  } else {
    lines.push(`  verdict       : FAILED (${result.errors.length} problem(s))`);
    for (const error of result.errors) {
      lines.push(`    [${error.check}] ${error.message}`);
    }
  }
  return lines.join("\n");
}

// ── CLI entry ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo-root" && argv[index + 1] !== undefined) {
      options.repoRoot = argv[index + 1];
      index += 1;
    } else if (
      argv[index] === "--contracts-root" &&
      argv[index + 1] !== undefined
    ) {
      options.contractsRoot = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--help" || argv[index] === "-h") {
      options.help = true;
    }
  }
  return options;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: node scripts/verify-post-0.2-contracts.mjs [--repo-root <dir>] [--contracts-root <dir>]",
    );
    process.exit(0);
  }
  const result = validateContracts(options);
  console.log(formatVerificationResult(result));
  process.exit(result.ok ? 0 : 1);
}
