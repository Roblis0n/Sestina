# Post-0.2 implementation decisions (G0 freeze)

- **Document status:** `frozen_at_g0` — accepted and frozen on 2026-09-01.
- **Baseline commit:** `08bd5f29cd59e39f06a7de6d261aa84f73a5bc63`
  (`docs: accept post-0.2 restructure authority`, child of the `v0.2.0`
  release commit `caf893db7928bab91c4098eb04a7e4a8d4c62ffe`).
- **Branch scope:** local branch `pi/g0-contract-freeze`; `main` and the
  `v0.2.0` tag are not modified. This is a local contract-freeze commit only.
- **Applicability:** every post-0.2 gate from G1 onward. The machine-readable
  contracts live in `docs/product/restructure/contracts/` and are verified by
  `scripts/verify-post-0.2-contracts.mjs` plus
  `tests/repository/post-0.2-contracts.test.ts`.
- **Authority hierarchy:** `docs/product/restructure/README.md` is the
  acceptance entry; the 18-file plan set is the accepted target; current code
  and `v0.2.0` are implementation facts only; the adversarial product review
  is a question source, not a specification.

## 1. The single product loop

All implementation converges on one causal loop:

```text
Suggestion
-> Persistent Review Draft
-> State-bound Context Projection
-> Exact Context Manifest
-> Optional Provider Assessment
-> User Canonical Effect Preview
-> User Authority
-> Atomic Canonical Mutation
-> Receipt / Trace as Proof
-> Search / Attention / Resume / Recovery
```

Forbidden bypasses: Provider assessment cannot reach Authority; Appeal, Room,
Pilot, Agent Corrector, Memory, Receipt, and renderer state cannot form a
second canonical truth; Memory never becomes Evidence; Receipt is never the
result.

## 2. User Authority boundary

- The Research Deliberation Kernel is the only owner of canonical research
  transitions and business rules. Renderer, Provider, Host, Skill, MCP,
  Memory, Appeal, Room, Pilot, and Receipt cannot create a second kernel.
- Only the user can commit a typed `CanonicalEffect`. Every commit requires a
  user actor plus an active local session capability; a model, agent, tool,
  signature, hash, or consensus can only propose or evidence.
- Provider availability, Provider failures, and assessment content never
  grant, remove, or substitute for user authority. All six effects work with
  no Provider configured.
- A user direction decision is not proof of fact; recording Evidence is not
  proof of fact; deterministic hashes prove bytes, not research truth.

## 3. Canonical Effect common invariants

- Exactly six kinds: `record_only`, `create_decision`, `add_evidence`,
  `create_or_resolve_issue`, `patch_brief`, `formal_direction_change`.
- Every effect binds `effectId`, `reviewId`, `projectId`,
  `baseProjectStateRevision`, `expectedObjectVersions`, `previewHash`, and a
  short public reason. Hidden reasoning is never stored or sent.
- Every effect commit is atomic: resulting object(s), revision head/event,
  Review terminal state, and Receipt/Trace land in one transaction or none.
- Commit requires the base revision to equal the current head; stale previews
  are rebuilt and re-confirmed, never auto-committed.
- Idempotency is keyed by `authorityCommandId`; retries return the committed
  result and never replay or double-create.
- `record_only` never mutates Brief/Decision/Issue/Evidence but still writes
  Review terminal state, one revision event, and one Receipt.
- External interfaces can never invoke an effect directly; every effect flows
  through the Kernel via a committed Review. See
  `contracts/01-canonical-effects.json`.

## 4. Review lifecycle

- `ResearchReview` is a persistent, versioned, recoverable, non-authoritative
  workflow aggregate. It is never a modal and never an in-memory Map.
- States: `draft`, `manifest_prepared`, `manifest_confirmed`,
  `provider_attempt_prepared`, `provider_attempt_running`,
  `provider_attempt_uncertain`, `provider_attempt_failed`,
  `assessment_recorded`, `stale`, `disposed`, `committed`, `cancelled`.
- Terminal states (`committed`, `disposed`, `cancelled`) are final and
  traceable; re-opening happens only through a new Review, corrections are
  appended child records, and compensations are new effects.
- A running attempt that crashes recovers as `provider_attempt_uncertain`;
  the system never resends automatically and never claims certainty it does
  not have.
- `effect_preview_ready` is a persistent Review attribute, not a second state
  machine. See `contracts/02-review-lifecycle.json`.

## 5. projectStateRevision rules

- Starts at 1 from the migration baseline; one baseline event; no fabricated
  history. Monotonic; never decreases; compensation advances N to N+1.
- Advances exactly once per canonical transaction (each effect,
  record-only outcome, Memory governance change, privacy redaction,
  compensation, migration baseline).
- Never advances for Review drafts, Manifests, Provider attempts and
  assessments, corrections, second opinions, Host drafts, Provider settings,
  UI preferences, or projection rebuilds. Provider generation changes only
  make Manifests stale.
- Optimistic concurrency compares the expected revision against the head
  inside the transaction; mismatch rolls back and reports precise changed
  objects. Failure leaves the revision unchanged; unknown commit outcomes are
  resolved by `authorityCommandId`, never guessed.
- Receipts and Traces bind to the revision in the same transaction; recovery
  validates the head against the event chain and fails closed. See
  `contracts/03-project-state-revision.json`.

## 6. Context Manifest identity rules

- Identity: `projectId`, `projectStateRevision`, projection policy and schema
  versions, `contextProjectionHash`, `exactRequestHash`, protected local
  `exactRequestBody`, `exactRequestBytes`, Provider identity and generation.
- Projection is deterministic: fixed category order, ascending ids, canonical
  JSON with sorted keys, UTF-8, SHA-256 lowercase hex. The canonicalization is
  a signed, versioned policy resource.
- Default exclusions: raw Receipt/Trace bodies, full history, old Provider raw
  outputs, secrets, nonces, absolute paths, hidden reasoning, unselected or
  `never_send` Memory, other projects.
- Preview and payload are the same bytes by `exactRequestHash`; send-time
  revalidation recomputes all four identities from a fresh snapshot and fails
  closed with a precise stale reason before any network I/O. See
  `contracts/04-context-manifest-identity.json`.

## 7. Evidence, Brief, Memory separation

- **Evidence** is the single canonical `argument_evidence` (`revd_`)
  aggregate; `add_evidence` becomes its only production writer. The legacy
  `evidence_items`/`situation_assertions`/`claims` ledger is read-only
  migration and legacy-import source, never canonical and never dual-written
  (CV-01).
- **Brief** carries constraints and thresholds; its missing sections become
  explicit Context limitations. `EvidenceThreshold.minimumSourceClass` is a
  new typed enum aligned with the canonical provenance model; legacy
  free-text `evidenceBoundaries` migrate as legacy threshold rules with
  limitations (CV-03).
- **Memory** is non-authoritative context with four user states; it stores
  source object ids and fingerprints, not object bodies. Forget removes the
  current row and unsent manifests; the copy inventory and privacy redaction
  ledger are target capabilities that do not exist yet (CV-04).
- Provenance, threshold, and maturity are never merged into one quality
  grade; Memory is never Evidence; Receipt is never the result.

## 8. Legacy concept and target concept mapping principles

- Preserve history losslessly where semantics map; mark lossy mapping
  explicitly; freeze legacy writes; no dual-write.
- Generic `accepted`/`modified_accepted` become lossy legacy record-only with
  `canonical_effect_unresolved=true`; they never fabricate Decisions or
  Evidence. `direction_changed` maps to `formal_direction_change` only when
  Brief before/after evidence matches; `rejected`/`deferred` map losslessly to
  `record_only`.
- Room and Pilot become read-only history with explicit convert-to-Review;
  Appeal folds into Review corrections; Memory keeps its kernel with a
  four-state surface; `review_runs` stays an internal checker subsystem and is
  never the interactive Review.
- MCP stays read-only; Skills stay draft-only; the CLI stays a thin Kernel
  transport with user actor plus explicit confirmation; Agent Corrector is
  branch-only at baseline and merges at G7 as an ephemeral companion Skill.
  See `contracts/05-legacy-mapping.json`.

## 9. Route map

- Primary entries: Today / Review, Project, Search, Settings. Object details
  live under Project/History; Recovery is reached from the startup blocking
  state and Settings.
- Only `/project/reviews/:reviewId` forms Canonical Effects, and only through
  the user's explicit decision step. Brief editing creates candidates only;
  Settings never forms research effects.
- Legacy routes become aliases, redirects, or 410 read-only dispositions;
  legacy routes never regain write capability. See
  `contracts/06-route-map.json`.

## 10. Provider and desktop boundary

- Provider requests: configuration-time endpoint validation (external HTTPS
  only, explicit loopback HTTP, no credentials/query/fragments, private and
  metadata literals rejected), `redirect=error`, retry 0, size and timeout
  caps, exact-body send-time comparison. Connect-time DNS pinning and an
  explicit proxy policy do not exist at baseline and are frozen as G10
  security gates; until then the limitation is documented and external
  endpoints stay fail-closed where the transport cannot enforce address
  policy (CV-07).
- The loopback preview binds `127.0.0.1`, requires a loopback Host header,
  uses session tokens for mutations, and serves static assets only from the
  packaged client asset root.
- Secrets use OS secure stores with no plaintext fallback:
  `secure_storage_unavailable` means the key is not saved and Provider use is
  blocked, never silently persisted on disk.
- Target distribution is one Electron desktop app with typed preload IPC and
  no public UI HTTP; the `v0.2.0` archive remains accurately described as a
  local loopback research server preview. No Electron shell exists at
  baseline and none is built in G0.

## 11. Seven code-verification decisions (summary)

| ID    | Frozen conclusion                                                                                                                                           | G1 impact                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| CV-01 | Two Evidence aggregates exist; no production write path exists. `argument_evidence` becomes the single canonical aggregate; `add_evidence` its only writer. | Evidence fixtures target `argument_evidence` only.                        |
| CV-02 | Transaction/UoW/CAS building blocks exist; revision guard, snapshot, and persistent Review are absent.                                                      | Concurrency fixtures target current UoW seams.                            |
| CV-03 | Provenance and Brief threshold are separate; no misuse path exists; new threshold enum requires migration.                                                  | Threshold fixtures use typed legacy shapes.                               |
| CV-04 | Memory does not duplicate bodies; forget has no copy inventory or redaction ledger yet.                                                                     | Forget/restore fixtures cover the inventory gap.                          |
| CV-05 | MCP read-only, Skill instruction-only, CLI Kernel-bound; Agent Corrector branch-only.                                                                       | Interface fixtures cover read/draft/authority parity.                     |
| CV-06 | Journal/schema version/retry/backup exist; copy-on-write and staging swap absent; no dual-write.                                                            | Migration fixtures with SHA-locked corpora.                               |
| CV-07 | Config-time address validation, redirect=error, loopback containment, fail-closed secrets exist; DNS pinning and proxy policy absent.                       | Network fixtures capture current behavior; G10 designs the pinning tests. |

## 12. Decisions G1 may rely on (frozen)

- Effect kinds, Review states and transitions, revision increment matrix,
  Manifest identity and canonicalization, legacy dispositions and mapping
  quality labels, route responsibilities, terminology and claim levels, and
  all seven CV conclusions with their evidence paths. G1 may not re-litigate
  these; a genuine code contradiction must be handled through the conflict
  process described in `16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md`
  (update every impacted contract and the decision log together).

## 13. Explicit non-goals of G0

- No production domain model, schema, or migration changes.
- No G1 or later gate work; no Electron shell, production UI, Provider
  network layer, MCP/Skill/CLI capability changes, or Agent Corrector merge.
- No trial feedback, adoption, market, or Provider-quality claims.
- No release, tag movement, `main` modification, or push.
- No weakening of contract requirements to make verification pass, and no
  fabricated code evidence.

## 14. Unimplemented at the G0 freeze, but decided

Everything below records the accepted target design as it stood at G0. For
the subsequent G1–G3 implementation and verified boundary, consult
[IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) and
[G1-G3-EVIDENCE.md](G1-G3-EVIDENCE.md). This historical list is not a new
approval requirement and does not override the authorized implementation.

- Persistent Review aggregate, attempts, corrections, and Manifests (G2/G5).
- `projectStateRevision` head/event chain and snapshot-bound projections (G2/G3).
- Typed effect handlers and the single `commitCanonicalEffect` entry (G4).
- Progressive Brief with section states, thresholds, known unknowns, and
  coverage (G6).
- Memory four-state surface, forget copy inventory, and privacy redaction
  ledger (G7).
- Appeal-in-Review, legacy Room/Pilot read-only freeze, Host draft bridge
  (G7/G9).
- Copy-on-write migration pipeline with staging and atomic swap (G2).
- Task-first production UI and route cutover (G9).
- Electron desktop shell, typed IPC, signing, update, and uninstall lifecycle
  (G10).
- Connect-time Provider DNS/address pinning and explicit proxy policy (G10).
- Legacy active-path removal and final consistency proof (G13).

## G4–G5 integration clarification: derived invalidation

The actual application A/B and configuration-change tests exposed a conflict:
contract 04 requires stale identity to be saved before any network connection,
while contract 02 and the G3 repository omitted `prepared -> stale` and the
failed/uncertain rebuild entries. The omission returned `illegal_transition`
and rolled back the stale marker. Contract 02 now enumerates these derived
invalidation/rebuild transitions. Prepared attempts are cancelled atomically;
running attempts still require a recorded uncertain/failure outcome first.
This adds no Authority, terminal reopening or automatic send. The discriminating
tests are in `tests/post-0.2/foundation/kernel-application.test.ts`.

New canonical creations have entity version 1 even when domain construction
includes proposal and user-acceptance transitions before the first save.
Brief proposals and confirmation likewise form one persisted aggregate update,
advancing its version once. These operations reuse the existing constructors;
the single G3 commit remains the owner of object versions and project revisions.

Cancellation of failed, uncertain, assessed and stale nonterminal Reviews is
now explicitly enumerated in contract 02, following plan 04's user-cancellation
rule. It changes only workflow state; running I/O first becomes uncertain,
and terminal records remain immutable. The stale-cancellation regression
previously returned `illegal_transition` for this legal user action.

G4/G5 public design decisions:

- Kernel allocates result IDs and nested Brief IDs before confirmation. Drafts
  retain payload, object versions, exact preview, command identity and actor
  binding. Invalidated drafts retain user work but cannot be committed.
- Compensation is explicit, linked to the old Receipt, and uses a new Review
  with one of the same six legal effects. Ordinary continuation is not labelled
  compensation. Previews report `compensating_only` or `no_content_change`;
  they never promise deletion or revision rollback.
- New Evidence records require citation/locator provenance, with kind, recorder
  and time supplied by the canonical record and its user source. Initial links
  remain unproven/disputed/stale; no Provider result promotes support.
- A Receipt's assessment facts refer to its current Manifest. Earlier attempts
  remain immutable Review history; a subsequent local no-send snapshot does not
  borrow an earlier assessment or its request binding.
- Only AbortControllers and the opaque local session capability live in process
  memory. Running attempts are durable before network I/O; recovery never sends.
  Known protocol/transport failures and uncertain delivery remain distinct.
- New application services use the schema-25 opt-in entry. Default schema-20
  historical behavior remains isolated until the scheduled production cutover.


## G6/G7 implementation decisions

The existing six effects, canonical UoW, durable Review/attempt lifecycle and
single-read snapshots remain the only implementation foundations. The following
details reconcile concrete first-use and privacy behavior with the frozen input:

| User consequence | Required invariant and owner | Executable evidence |
| --- | --- | --- |
| Start with a question or task, without invented content | `patch_brief mode=initialize` requires absence of a Brief, allocates its IDs in Kernel, and commits version 1 with Review/Receipt/revision. Existing Brief changes still require exact base versions. Contract 01 records this first-use exception. | `foundation/progressive-brief.test.ts` |
| See the same missing context before and during assessment | Policy 1.1 binds typed Coverage and scope into the single projection, durable Manifest and exact bytes. All 13 field identities are validated; coverage cannot veto user Authority. Older policies are read-only until rebuilt and confirmed. Contract 04 records the binding. | `foundation/brief-coverage-binding.test.ts` |
| Recover a saved Brief after publication failure | Database state wins. Known old/current/pending hashes support repair; explicit missing-file recovery validates the schema-25 database and completed migration before atomic no-replace installation. Unknown files remain untouched. | `foundation/brief-publication.test.ts`, `foundation/brief-repair-http.test.ts` |
| Dispute an assessment without changing history | Correction and linked Review are saved together; original assessment/Finding remains immutable. Closure is derived from the child effect. Second runtime identity and context isolation are facts, never proof of independent judgment. | `foundation/review-correction.test.ts`, `foundation/correction-finding-path.test.ts` |
| Forget without later body resurrection | User-authorized privacy transaction tombstones Memory and redacts linked local bodies with before/after hash proof. Receipt/event hashes and terminal outcomes remain unchanged. Contract 02 makes this narrow body exception explicit. | `foundation/privacy-transaction.test.ts`, `foundation/legacy-memory-forget.test.ts` |
| Decide what happens to old backups | Explicit hash-bound inventory supports deletion or retention with restore disabled. Failures preserve a resumable cleanup record; no failure rolls back the tombstone. Unverifiable copies stay blocked. | `foundation/privacy-maintenance.test.ts` |
| Keep Host suggestions without granting permission | Project-bound envelope/call identity persists one draft. Temporary capability grants only draft submission and own status; no file reads, Provider calls, Memory selection or commits. | `foundation/host-draft-intake.test.ts` |

Native progressive Brief metadata has null legacy Schema/hash instead of invented
provenance. Migrated versions keep their original mappings; typed thresholds use
canonical Evidence kinds and inference capacities, distinct from support status.
Contract 05 documents this compatibility detail. The release baseline, immutable
old-fixture recipes and schema-20 default remain unchanged.

## G8/G9 implementation decisions

The user-facing increment is one saved research journey across Today, Review,
Project, Search and History. The Kernel still saves canonical state and workflow
records; users still confirm every research change and exact outbound request.
No new Authority, transaction state machine, automatic send or hidden reasoning
store is introduced.

| Requirement | Implementation and failure boundary |
| --- | --- |
| One source for all derived views | `readKernelWorkspaceSnapshot` captures validated canonical state, Review/attempt/Manifest/correction/Receipt/event records, privacy metadata and allowlisted legacy fields inside one SQLite read transaction. `projectKernelWorkspace` and `projectWorkspaceReview` only accept the captured immutable value. No I/O or authority capability enters these pure functions. |
| Workflow, privacy and time identity | Workspace policy/schema 1 binds project ID, validated canonical content hash, workflow/legacy hash, privacy hash and next Memory expiry. One `evaluatedAt` is used throughout the read. Pagination additionally binds the query. Integer revision equality is never sufficient, including after restore. |
| Safe disposable caches | The application calculates pages on demand. Existing optional projection metadata uses a format-1 envelope `{inputHash,payloadHash,payload}`. Old/unrecognised/damaged bytes are unavailable or rebuilding; explicit reconstruction uses current validated data and compares identity before publication. There is one bounded attempt, no busy retry. No schema migration or new table is needed; old migrations and immutable fixtures remain unchanged. Outbox/event records are never consumed or deleted. |
| Large reads without duplicate work | Canonical/record validation and full hash checks remain. Snapshot assembly freezes newly owned containers around already validated immutable records, instead of cloning the whole project again. Read-only functions never advance the head. Performance evidence reports actual measured samples and environment, not a hardware-independent promise. |
| Resource ownership | Opening/closing/switching/disposal invalidates a generation-scoped capability; late open closes its actual lease. Kernel close releases its database and aborts owned work even when persisting uncertainty fails. The next writable open recovers durable running attempts as uncertain, without sending. |
| Transport-independent application port | `apps/research-room/shared/kernel-port.ts` is the client-safe command/session/transport contract. HTTP implements it through the existing service and session gate; G10 will supply main/preload transport. Server generation and project binding reject old sessions. Client generation, query sequence and cancellation reject late results. No raw research content is broadcast. |
| Unsaved text | Server snapshot, base version and editing buffer are separate. Focus/read notifications cannot replace dirty text. Save captures the clicked text; later typing survives acknowledgment. Conflict preserves both versions. Leave offers save/discard/cancel. Privacy redaction clears affected buffers, including late save responses. Only saved records recover after crash; localStorage holds appearance/recent paths, never research draft bodies. |
| Startup/recovery | Explicit create refuses an existing `.sestina`; read-only browsing grants no mutations. Migration confirmation binds inspected source hashes. Pre-migration restore preview binds the current database pair and verified backup; stale confirmation and post-migration Forget refuse restoration. Existing recovery and missing-Brief repair services preserve unknown files and failures. |
| Content and old routes | React text rendering and bounded decoded JSON never interpret research content as code, HTML or Authority. Long Findings offer a short choice label and an inspectable full text. Old object links retain targets, composite relation identities remain navigable, old workflows remain source-labelled history, and candidate old creation routes return 410. |

This is the explicit schema-25 browser candidate only. The shipped v0.2.0/schema-20
default, official logo, Electron packaging and final cutover are not changed.

## G10/G11 candidate implementation decisions

These decisions describe the internal desktop work after G9. They do not amend
the preceding historical completion evidence or declare G10/G11 complete.

| User need | Owner, confirmation and failure boundary |
| --- | --- |
| Use the same saved research workflow in a desktop window | `packages/application-ports` owns the browser-safe typed contract; `packages/application` owns the neutral application adapter. Electron main supplies resources and native interaction; Kernel remains the only canonical writer. The HTTP candidate imports the same adapter. |
| Confirm a change or exact outbound request | Main obtains a fresh Kernel snapshot and immutable binding. A native dialog supplies the final user answer. The one-use grant expires, is revoked on session/navigation changes, and cannot be created by renderer JSON. Native copy quotes identifiers and exposes proof without treating research text as system instructions. |
| Close a project without late work reviving it | Main closes the existing application session and Host listener, revokes confirmation and aborts credential prompts on close, crash or suspend. Renderer-crash teardown destroys the unreachable window instead of waiting for its dirty-text guard. Persisted attempts retain their existing uncertainty recovery. |
| Send only the checked request | The neutral Provider transport validates all DNS answers, pins the connection, retains hostname certificate verification, ignores implicit proxies, disables redirects and sends once. Redirect after a possible send is uncertain. Provider configuration generation has a persistent high-water mark across delete/restart/recreation. |
| Read through MCP while the desktop owns a write lease | Core exposes a bounded read-only schema-25 context from one validated SQLite snapshot, including source revision/hash and excluding Memory/outbound bodies. MCP never imports private storage or obtains Authority. Legacy reads retain their separate source classification. |
| Inspect where an installer came from | Candidate manifests bind the real source commit/tree, committed lock, build toolchain, migration source, official Logo and allowlisted files. Actual ASAR bytes and the Windows executable architecture are checked. Two independent unsigned-core builds must agree; unsigned candidate status is explicit. Public tags, signing and notarization are separate checks. |
| Know whether an update was checked | The candidate has no configured trusted production source. Settings reports source unavailable on explicit check. Signed-identity verification, bounded downloading, private staging, cancellation, pre-upgrade backup, installer launch and preserved-program recovery are implemented. Actual Windows upgrade/recovery passed with synthetic service trust; this does not establish production trust or a signed production upgrade. |

Windows installation screenshots are evidence of the installed renderer only.
Synthetic picker/confirmation answers in automation are never native-dialog
acceptance. OS-specific credential, focus, motion, migration and installer results
remain individually recorded. No Windows result establishes macOS/Linux behavior.

## Authorized local G12/G13 execution order, 2026-09-13

The user explicitly authorizes G12 implementation, local verification and candidate
packaging on the unpublished branch despite outstanding G10/G11 external-platform,
signing and native-observation acceptance. G13 local cutover may follow after the
relevant G12 implementation and executable core data-safety/function checks pass.
Actual failures must be fixed. Missing native observation, macOS/Linux installation,
signing/notarization and production update trust remain mandatory formal acceptance
and publication requirements. Record implementation, local verification, complete
platform acceptance and publication separately. This changes execution order only;
it does not amend frozen plans, historical evidence, user Authority or privacy rules.
No public push, CI, tag, signing-service provisioning or Release is authorized.

## Desktop distribution continuation, 2026-09-14

The user authorizes finishing the remaining Windows observations and the formal
desktop distribution implementation in parallel with resource preparation. This
continues the accepted release/lifecycle plans; it creates no new product gate.
Missing platform/signing/native resources remain formal acceptance requirements.

The desktop product name is Sestina and the stable distribution appId is
`org.sestina.desktop`. Candidate and release configurations build the same app.
The previous internal `org.sestina.candidate` installer remains a historical
installation, not an automatically removed user program. The established
`Sestina Candidate` Chromium/userData/secure-storage service name is intentionally
retained for existing settings and encryption continuity; it is not the product
name presented by the installer. Research projects remain independently owned.

The proposed next public version is `0.3.0`, pending one explicit confirmation
before a public tag. Local versions use the parameterized base and source suffix;
release mode requires an exact approved existing tag, clean detached source,
explicit target signing resources and installed production update roots.
Candidate mode never consumes production trust or inherited signing accounts.
This version proposal does not alter published `v0.2.0` or its frozen evidence.
