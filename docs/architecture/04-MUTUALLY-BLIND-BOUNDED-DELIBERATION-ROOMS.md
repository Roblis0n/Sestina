# RI-50 Mutually Blind, Bounded Deliberation Rooms

Status: `implemented_and_verified`

This contract defines the production RI-50 Deliberation Room. It is subordinate
to the current product definition and is the architecture source for the Room
aggregate, two-participant protocol, persistence, API projections, production
UI, failure contraction, and evidence claims.

## 1. Product boundary

A Deliberation Room is a project-bound research object for one frozen,
high-impact dispute. It is not a general chat, a model arena, a vote, a
consensus engine, or a persistent Agent personality.

The only complete path is:

```text
eligible project source
  -> direct-user Room draft
  -> frozen source/question/context/dimensions/participant bindings
  -> two visible Context Manifests
  -> explicit user confirmation
  -> two sealed mutually blind initial requests
  -> explicit reveal
  -> deterministic Difference Summary
  -> zero or one user-confirmed directed challenge
  -> direct-user Room Resolution
  -> append-only Receipt/Trace
```

The Room never edits its source Issue, Appeal, Finding, Brief, Decision, or
Evidence. Any later canonical change continues through that object's existing
Authority Gate.

## 2. Layer ownership

| Layer | Owns | Must not own |
|---|---|---|
| `@sestina/research` | Room aggregate, legal transitions, frozen records, call/round limits, append-only history | HTTP, Provider transport, React state |
| `@sestina/review` | canonical participant request, strict response schema, prompt compilation, Manifest/request hashes | Room Authority, persistence, UI |
| `@sestina/core` | source validation, two bindings, CAS/idempotency, request freezing, attempt fencing, deterministic Difference, recovery, projections | hidden Provider state, UI-only rules |
| `@sestina/research-store` | project-bound atomic Room load/save/list | transition inference |
| `@sestina/storage` | schema 18 table/indexes and transaction boundary | domain decisions |
| Research Room server | exact local HTTP adapter, opened-project/session checks, abort wiring | duplicate state machine or automatic fallback |
| OpenAI-compatible adapter | one bounded request for one frozen participant attempt | retry, tools, Authority, raw-response persistence |
| React client | typed projections, explicit confirmations, safe terminal-state rendering | authoritative state or protocol inference |

## 3. Canonical aggregate

`DeliberationRoom` retains:

- project and source kind/ID/version/hash;
- frozen question, active Brief snapshot, preserved Decisions, selected
  Issues/Evidence, comparison dimensions, and excluded Context;
- exactly two `RoomParticipantBinding` snapshots with Provider, Model, Harness,
  connection, config generation, secret reference, runtime identity, role, tools,
  Memory, and capability limits;
- two participant Context Manifests and their canonical/request/state hashes;
- initial round, attempts, normalized public assessments, explicit failure or
  cancellation results, reveal mode, and deterministic Difference Summary;
- at most one explicit failed-participant retry or one two-participant directed
  challenge under the four-call ceiling;
- manual public external opinions with capture time, asserted identity, Context
  exposure, and non-verifiable blindness status;
- append-only Resolution, Resolution Receipt, transitions, and idempotent command
  receipts.

Canonical statuses are:

```text
draft
context_prepared
awaiting_manifest_confirmation
blind_round_running
reveal_ready
difference_review
retry_prepared
retry_running
challenge_prepared
challenge_running
waiting_user_resolution
partial
failed
cancelled
stale_conflicted
resolved
closed
```

Every mutation is project-bound, checks an expected version and command ID, and
records the resulting version. An identical command replay returns the existing
result; a reused command ID with different content fails closed. Resolution
supersession appends history and never overwrites an earlier Resolution.

## 4. Source and participant binding

Legal source kinds are `correction_appeal`, `unresolved_conflict`,
`research_issue`, `research_decision`, `research_brief`, and
`explicit_project_object`. Core resolves the source from the currently opened
project, freezes its version/hash, and rejects cross-project or missing sources.
An observed source change invalidates the earlier confirmation and moves the Room
to `stale_conflicted` until a direct refresh creates a new valid binding.

The participant pair is fixed for the Room. Provider, Model, Harness,
Connection, Participant, and Role remain separate fields. The two bindings must
have distinct connections and distinguishable runtime identities. A missing
pair contracts to `blocked_missing_user_config`; equal or unverifiable identities
contract to an explicit unavailable/same-runtime state. Neither condition is
presented as mutual blindness.

## 5. Manifest and request equivalence

Each participant receives one independently compiled request from the same
frozen research input plus its visible public role instruction. Each Manifest
lists included objects, excluded classes, versions, hashes, transport preview,
request size, token limit, tool policy (`none`), Memory policy (`room_only`), and
the Provider/Model/Harness/connection/runtime snapshot.

Both canonical request bodies and hashes are prepared before either Provider is
called. The user confirms the exact two Manifest hashes. Core rechecks source,
Room, config, state, and request bindings immediately before dispatch.

Initial request A contains no B output, B private Context, B session, B request,
or B Provider state. Request B has the symmetric exclusion. One participant
finishing first cannot mutate the already frozen peer request. The client sees
only safe running/terminal status until an explicit reveal command; this UI seal
is secondary to the request-level protocol isolation.

No hidden chain of thought, raw Provider response, credential, authorization
header, complete network payload, or participant-private session is persisted or
projected.

## 6. Strict participant protocol

Protocol, prompt, and rubric version `1.0.0` require exact JSON keys and bind the
response to project, Room, round, participant, request, state, Context, and
source hashes. A normalized public assessment contains finite positions,
conclusion, bounded claim units, project Evidence references/spans, assumptions,
scope, counterexamples, alternative explanations, uncertainties, unknowns,
next discriminating Evidence, and a recommended next step.

Malformed JSON, unknown keys, invalid enums/IDs/spans, duplicate dimensions or
claims, unselected Evidence, source/hash mismatch, oversize output, control
characters, tool requests, external references, Authority commands, forged user
Resolution, partial streams, multiple finals, stale results, and late results
from cancelled/superseded attempts create no valid assessment. Only one legal
terminal result can win an attempt fence.

## 7. Bounded calls and cancellation

The Room allows no automatic retry or fallback. The hard ceiling is four
Provider calls:

- calls 1–2: one frozen initial request for A and B;
- either call 3: one direct-user-confirmed retry for the failed participant,
  after which challenge is unavailable;
- or calls 3–4: one direct-user-confirmed challenge request for A and B;
- no fifth call, synthesis call, second challenge, or hidden connectivity probe.

The server owns one abort controller per active Room operation. The user can
cancel both active calls without blocking the UI. Cancellation and timeout are
explicit attempt terminals; late results are fenced and cannot become current
Room state.

## 8. Reveal and deterministic Difference

A complete reveal requires two legal terminal assessments and a direct user
command. A one-success result requires an explicit partial reveal. Cancellation
may reveal an already legal completed assessment only after an explicit user
action. One participant completing while the peer is running never produces a
complete comparison.

`deriveDeliberationDifferenceSummary` uses only normalized assessment fields and
the frozen dimensions. Categories are `common_ground`, `direct_conflict`,
`qualified_difference`, `fact_selection_difference`,
`evidence_weight_difference`, `assumption_difference`, `scope_difference`,
`candidate_unique_increment`, `redundant_restatement`, `unresolved`, and
`unproven`.

Text/hash inequality alone is not a unique increment. A candidate increment
requires a traceable Evidence selection, counterexample, boundary/assumption,
alternative explanation, unknown, or next discriminating Evidence missing from
the peer assessment. It remains a candidate; real-case value is still
`unproven`. The summary has no winner, rank, score, vote, average confidence, or
third synthesis Provider.

## 9. Directed challenge

After complete Difference review, the user may edit and confirm one shared
question. Core generates two new Manifests. Each challenge request may contain
only the user-confirmed shared question, Kernel Difference Summary, and permitted
public structured peer assessment. It cannot contain peer private Context,
session, raw response, hidden reasoning, or user-only content.

The challenge is optional. The user can skip it and proceed to Resolution. A
retry path consumes the remaining bounded-call option and cannot be combined
with a challenge that would exceed four calls.

## 10. User Authority and manual contraction

Only `direct_user` may reveal, finish review, import a manual opinion, resolve,
supersede a Resolution, or close a Room. Supported Room dispositions are
`adopt_a`, `adopt_b`, `combine_edit`, `keep_disputed`, `request_evidence`, and
`close_without_change`. The default effect is Room-only. The Resolution Receipt
states that any Decision, Issue, Brief, Finding, Appeal, or Evidence change needs
its separate existing Authority command.

Manual external opinions are public candidate records, never blind participants.
They retain capture time, user-supplied Provider/Model claims, Context disclosure,
whether A/B output was visible, and `not_verifiable` blindness. They do not
retroactively make a partial Room complete.

## 11. Persistence and migration 018

Migration 018 raises the project database schema to 18 and adds the STRICT
`deliberation_rooms` table. The row key is `room_id`; `project_id` references the
project; source kind, source ID, status, version, source hash, timestamps, and
canonical JSON are stored. Indexes support project/update order, status,
source history, and a unique active Room per project/source. Existing migrations
are unchanged.

Repository writes serialize the complete canonical aggregate inside the same
SQLite transaction as the command result. CAS/version failure rolls back. A
corrupt or semantically impossible persisted aggregate fails closed rather than
being normalized into a plausible history.

## 12. Local API contract

Read projections:

- `GET /api/project/deliberation-rooms`
- `GET /api/project/deliberation-rooms/:roomId`
- `GET /api/project/deliberation-rooms/:roomId/assessments`
- `GET /api/project/deliberation-rooms/:roomId/difference`

Writes:

- `POST /api/project/deliberation-rooms`
- `POST .../:roomId/refresh-source`
- `POST .../:roomId/prepare`
- `POST .../:roomId/run`
- `POST .../:roomId/cancel`
- `POST .../:roomId/reveal`
- `POST .../:roomId/prepare-retry`
- `POST .../:roomId/run-retry`
- `POST .../:roomId/prepare-challenge`
- `POST .../:roomId/run-challenge`
- `POST .../:roomId/finish-review`
- `POST .../:roomId/manual-opinion`
- `POST .../:roomId/resolve`

Every write accepts exact keys, the opened `projectId`, explicit `confirmed:
true`, and—except source refresh—an expected version and command ID. The adapter
rejects cross-project IDs, extra keys, missing confirmation, bad versions, and
invalid action payloads before calling Core. Typed client decoders reject a
malformed server projection instead of rendering it.

## 13. Product projections and UI

Deliberation Rooms participate in project Search, Overview recent history,
Attention, Receipt/Trace, deep links, reload, and restart recovery. There is no
permanent global blank-Room navigation. Issue and unresolved Appeal views provide
source-bound entry points. Active, partial, failed, stale, reveal-ready,
difference-review, and waiting-resolution Rooms appear in Attention; resolved or
closed Rooms remain in history and Search.

The production workspace exposes source/frozen question, protocol bar,
participant identities, Manifest pair, sealed running states, reveal gate,
Difference-first view, optional challenge, manual opinion, user Resolution, and
append-only history. Running views render neither assessment content nor a
premature Resolution form. Chinese/English, Light/Dark/vivid High Contrast,
desktop reflow, long content, 200% text, reduced motion, cancellation, partial,
failure, and reload are verified on the production route.

## 14. Recovery and evidence boundary

On process restart, an active Provider call cannot be proven completed. Core
records `result_write_uncertain`/unknown interruption and does not auto-resume or
invent a result. One failure produces honest partial state only after user reveal;
two failures produce failed state and no complete Difference. Missing Providers
preserve the Room and permit manual opinion/Room-only Resolution without claiming
a two-participant completion.

Loopback Providers, synthetic projects, protocol captures, tests, builds, and
screenshots prove implementation and host behavior only. They do not prove real
Provider semantic quality, mutual cognitive independence, repeatable
non-redundant value in real research, external-user value, adoption, or market
demand. Those claims remain blocked or `unproven` until separately obtained.
