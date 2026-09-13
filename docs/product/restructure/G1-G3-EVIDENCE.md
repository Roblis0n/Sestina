# G1–G3 implementation evidence

Implementation starts at G0 `a4889ee996064d95ee0a3fb470ee6ee12d3a91a3`.
The released source remains `caf893db7928bab91c4098eb04a7e4a8d4c62ffe`.
All project inputs below are synthetic. No Provider quality or external-user
claim follows from these tests.

## Initial behavior evidence, before implementation

`node node_modules/vitest/vitest.mjs run --config tests/post-0.2/vitest.downstream.config.ts`
was run on the G0 production code on 2026-09-06. Eight assertions failed from
observed behavior, after fixture validation was corrected:

| Finding / gate | Observed failure | Executable test |
| --- | --- | --- |
| P0-01 / G4 | Generic accepted and modified_accepted succeed without typed targets | `tests/post-0.2/downstream/findings.test.ts` |
| P1-01, P1-03 / G4 | Unconfigured, failed, invalid Provider blocks a user's direction change | Same, Provider matrix |
| P0-01 / G5 | A confirmation still sends once after B records an outcome | Same, A/B scenario |
| P1-02 / G5 | Schema-valid unsupported rationale produces semantic_ready | Same, claim-level assertion |
| P1-05 / G5 | A prepared Review has no persistent representation after restart | Same, restart scenario |
| Transaction / G3 | A failed nested ResearchUnitOfWork's project creation survives an outer commit | `tests/post-0.2/foundation/atomic-boundary.test.ts` |

The downstream command deliberately exits nonzero. It is separate from the
foundation regression command, has no skip/todo/expected-failure wrapper, and
must not be reported as repaired by G1–G3 storage work. Production adapter
cutover and six effect handlers belong to G4 and later gates.

Initial pnpm invocation attempted an environment-dependent reinstall; that
error is **not** RED evidence. The commands above used the installed Vitest
entry directly and reached the actual assertions.

## Immutable old corpus

`scripts/materialize-post-0.2-legacy.mjs` extracts the pinned release's packages
with `git archive`. Its resolver binds every Sestina import to that extracted
source's public package entry, never the current workspace implementation.
The synthetic recipe calls old domain functions, repositories and Core. It
creates schema 16–20 samples, old dispositions including direction rollback,
and all six Memory states where supported. Two independent materializations
matched database bytes and Brief hashes.

`tests/post-0.2/legacy-provenance.json` freezes source archive hash, recipe hash,
schema, database SHA-256, Brief SHA-256 and expected migration semantics.
Databases and source archives are generated only under ignored temporary
directories. They are not committed as project state. A normal materialization
verifies the lock and refuses an occupied output database; `--freeze` is only
for the initial, reviewed fixture recipe, not a runtime migration operation.

## Implemented foundation and public design record

All new production paths are opt-in through `openKernelProject` and
`migrateKernelProject` in the public Core package. The released default
`openSestina` / migration manifest remains schema 20 until the later cutover.
No production interface, Provider orchestration or six effect handler has
been substituted in this change.

| User consequence / invariant | Persisted fact and owner | Failure boundary / executable evidence |
| --- | --- | --- |
| A rejected transaction cannot leave an apparently accepted object | Existing SQLite transaction plus `ResearchUnitOfWork.kernel`; object, event, head, terminal Review, Receipt, command identity and projection outbox are one commit | Real repository rollback at each canonical write plus Memory metadata/privacy writes, hard process death, nested failure, command replay and uncertain-commit lookup |
| A workflow attempt cannot become research authority | Review drafts, attempts, exact Manifests and immutable assessments/corrections persist separately; workflow write mode cannot acquire canonical access | `workflow`, `revision-matrix`, `corrupt-workflow`, all twelve durable Review stages in `process-crash` |
| Two competing approvals cannot produce two revisions of the same base | `BEGIN IMMEDIATE`, expected project revision, object versions, immutable command identity, separate live Review/governance authorization callbacks | Two real worker processes released at a barrier; exactly one commits, the other returns `stale_revision` with changed objects |
| A displayed projection cannot mix two project states | One SQLite read snapshot validates head, hash chain and canonical rows; deterministic policy selects bounded context; views carry source revision | Interleaved second-connection commit; forged snapshot / unknown selection rejection; derived rebuild failure and stale hiding |
| Failed upgrade must preserve the old project | Core maintenance lease, read-only preflight, immutable prebackup, staged schema 21–25 and backfill, full validation, external journal and pair switch | Schema 16–20, individual durable migration seams, hard-kill switch seams, unknown/corrupt/future/partial inputs, unknown replacement and tampered backup rejection |
| Restoring old data cannot resurrect a new forget | Downgrade restores only the verified old pair; post-migration privacy redactions deny that downgrade; there is no reverse migration | `downgrade`, Memory `forget`, and zero-socket restore scenario |

Schema 021 adds project heads/events and migration provenance. 022 adds
versioned Reviews, attempts and immutable correction records. 023 binds exact
Context Manifests, Receipts and command identities. 024 records Brief section
coverage, legacy mappings, Memory confirmation revisions and Resume metadata.
025 adds derived projection state/outbox and privacy/copy inventory metadata,
and freezes legacy write tables. SQL foreign keys, checks and uniqueness are
supplemented by strict record and cross-record validation before writable open.
Both old and target schema structures have reproducible structure fingerprints;
these check schema compatibility, never user authority or semantic truth.

The Brief database aggregate and its coverage metadata update together. The
on-disk Brief is explicitly a derived file with a verified source revision;
after a canonical change a known older file is reported `rebuilding` and is
never a write basis. Unknown file contents fail closed. The later Brief/UI
gate owns automatic publication of a rebuilt user-facing file.

Migration preflight enumerates every old table, row count, exact content
fingerprint and canonical/history/derived/maintenance disposition. Staging
validation compares every preserved table with that inventory. Legacy
accepted/modified receipts become historical disposed Reviews with
`legacy_record_only_unresolved_effect`, not invented Decision or Evidence.
Direction changes and rollback retain original Brief/provenance. The project
gets exactly one real revision-1 baseline, not an invented historical sequence.

The expanded old corpus adds all observed Appeal/Room/Pilot state combinations
and empty, long Brief and 1,000-Decision projects. `legacy-states-provenance.json`
records exact old test source hashes and the observer recipe. The observer
executes old production public functions and the original old assertions;
only synthetic Pilot input ID ranges are spaced to remove overlapping IDs in
the old unit-only fixture. One declared Appeal waiting state has no old public
transition helper and is explicitly a synthetic serialized input verified by
the exact old decoder and repository. It is not claimed as an observed flow.
`legacy-volume-provenance.json` separately freezes old-source volume recipes.
Normal tests independently regenerate and verify all locked samples.

The release corpus uses a separate, exact `caf893d` source worktree. The old
`build-release.mjs` executes without changes; every Sestina dependency resolves
inside that old source. Two builds created identical Windows x64 archives, then
a separate normal reproduction matched the frozen full-source/recipe/archive
hashes in `legacy-release-provenance.json`. This is a rebuilt old-code fixture,
not a claim about downloaded GitHub Release bytes. The production tag verifier
also has an executable downstream RED: it currently accepts a schema-valid
manifest whose source commit does not match `v0.2.0`. G10/G12 own closing it.

## Boundary audit after the initial implementation

These are public design and test records, not private reasoning:

| Observed failure before repair | Repair and executable discriminator |
| --- | --- |
| Recovery accepted or quarantined an unrecorded WAL after a partial switch | Check recorded source-WAL identity before opening SQLite or moving files; both partial-target and complete-target cases reject and preserve unknown bytes. |
| A Receipt did not directly bind its Manifest identity | The immutable Receipt stores Manifest id/hash and assessment attempt id; writable open validates the same relationships without copying outbound content. |
| An uncertain Provider attempt was described as failed | Preserve the attempt's uncertain fact and report assessment unavailable; a valid user outcome still commits through the same transaction. |
| No-Provider Manifest recovery could lose explicit Issue/Evidence selection | Persist the selection and bind it into Manifest identity; validate its project and Memory eligibility against the current canonical snapshot. |
| Canonical reference decoding admitted unknown kinds and mismatched prefixes | Strict kind/id decoding rejects malformed references while retaining genuine legacy Brief-version references. |
| Receipt and revision-event decoders accepted version zero as a saved result | The separately committed RED tests in `06602ff` distinguish creation preconditions from durable results; Review terminal outcomes, Receipts and events now require saved versions at least one. |
| Memory metadata/privacy writes had no individual interruption seam | Both writes have injected-failure tests proving the original body, metadata, privacy state, head and absent Receipt after rollback. |

Actual process-death tests also cover backup/staging copy gaps, each schema
advance, every switch/restore rename boundary and all twelve persisted Review
states. OS-enforced read-only directory tests prove the old project remains
readable and unchanged. These extend the initial failing nested-transaction,
schema, Brief binding, large-baseline and no-op privacy regressions retained in
the foundation suite.

## Executable entries and evidence boundary

- `pnpm test:post-0.2:foundation` runs the real database foundation regression.
- `pnpm test:post-0.2:downstream` intentionally exits nonzero for later target
  behavior. Actual Provider timeout, user-skip persistence, legacy resolution
  and release-entry declarations supplement the original eight failures.
- `pnpm test:post-0.2:ui-downstream` builds the real client/server, starts that
  bundle against synthetic projects, and exercises language, three themes,
  keyboard, long text and 200% text. Current failures are twelve primary
  entries instead of four and five editable JSON fields instead of typed
  controls. These are observed target gaps, not production UI acceptance.
- `pnpm verify:post-0.2:discovery` validates the nine-finding map and rejects
  skip/todo/expected-failure wrappers. It does not convert downstream RED to PASS.
- `pnpm verify:public` now includes the frozen G0 inputs, foundation regression,
  schema reproduction and discovery, in addition to all existing gates.
- `pnpm test:post-0.2:legacy-release <pinned-source-worktree>` reproduces the
  immutable old release fixture. Setup and maintenance APIs are documented in
  [operations and G4 continuation](G1-G3-OPERATIONS.md).

The controlled loopback TCP fixture covers reset and timeout after body write,
redirect, invalid JSON and oversize response. Its capture proves exact bytes
and lack of retries in that test environment only. A socket-denial test runs
preflight, migration, no-assessment canonical commit, projection and verified
downgrade with every network connection forbidden. No real Provider is used.

## Completed verification and continuation boundary

At `c9ed436`, the exact committed tree passed `pnpm verify:public` and native
`pnpm verify:platform win32 x64`. The public gate includes production lint,
all package typechecks, 330 production regressions, all 10 G0 contract/state
files, fixture/schema reproduction, discovery, 193 foundation assertions,
documentation, repository, architecture, privacy and public history checks.
A broader research/storage run passed 520 assertions; its three existing
child-process entrypoints are dispatched and checked by parent tests, not
counted as standalone passes. All new foundation tests run without skips.

The independent downstream runs report 15 domain and seven built UI failures,
with no pending or expected-failure wrappers. Their owners remain G4–G13.
Windows artifact verification proved identical rebuilds and the existing
offline lifecycle. The default remains schema 20; this is not Electron or
target UI acceptance.

The final implementation tree is
`e08c760e0adcf63c1ea54b22103b903b5e17ec83`. Its
[CI run 34031380557](https://github.com/Roblis0n/Sestina/actions/runs/34031380557)
completed successfully on 2026-09-06:

| Native evidence | Result and scope |
| --- | --- |
| Shared Ubuntu public gate | PASS: complete `pnpm verify:public`, including the foundation, frozen inputs and all existing public checks. |
| Windows x64 | PASS: 193 foundation assertions, deterministic archives, exact artifact contract and native offline lifecycle. |
| macOS arm64 | PASS: the same foundation and platform entry on the actual macOS runner. |
| Linux x64 | PASS: the same foundation and platform entry on the actual Linux runner. |

All three lifecycle reports recorded zero network attempts. Windows DPAPI and
macOS Keychain were available. The Linux runner had no Secret Service; its
verified path is explicit secure-storage unavailability and offline operation,
not a claim that live Linux keyring persistence was exercised. No secret-store
implementation changes belong to G1–G3, so this does not block this scope.

The platform entry runs the full database foundation on each native runner.
CI pins Node 24.13.0 to the immutable fixture toolchain and fetches the old
source history on all platforms. The user authorized pushing only this
implementation branch and running the existing artifact matrix; no release
was published. A local clean checkout of `e08c760` also passed the full public
gate. After all native gates passed, the user requested fewer gates; the final
status/documentation-only commit receives focused checks without repeating the
already successful full matrix. Its runtime is identical to the verified tree.

G1, G2 and G3 are `completed_and_verified`. There is no remaining blocker for
that G1–G3 scope. At that checkpoint G4–G13 were `not_started`; their 15 domain and seven built-UI RED
assertions are retained as executable continuation evidence, not repaired claims.

| Implementation history | Evidence contribution |
| --- | --- |
| `0b8ef35`, `1def5da` | Behavioral and missing-schema RED tests committed before implementation; pinned synthetic old-code recipes. |
| `2a76d15` | Opt-in schema, durable repositories, canonical UoW and copy migration foundation. |
| `8363407` | Recovery, exact Manifest/proof relationships and fault-boundary repairs with discriminating regressions. |
| `ba39528` | Independently rebuilt old release fixture and real source/tag mismatch downstream RED. |
| `06602ff`, `c9ed436` | Separately committed saved-version-zero RED, followed by the strict durable-proof repair. |
| `e08c760` | Native foundation in platform gates and synchronized architecture/privacy/recovery documentation; fully verified implementation tree. |

An initial full public run passed production lint, types and all selected
production regressions, then stopped at the repository shape gate because the
current working directory already contains ignored `spikes/` material. That
unrelated material is preserved. Repository/history and Windows platform gates
passed against the exact committed tree in an isolated verification checkout;
the check itself is not weakened or bypassed.

## G4–G5 execution evidence (current implementation)

G4/G5 work continues on `codex/post-0.2-g4-g5` from the verified G1–G3
completion `ae9a916deaa3c643f388ebda5ee4f2de1e044984`. The initial behavior RED
commit is `21abc0b`; failures came from the existing record decoders rejecting
persisted effect payloads and independent assessment facts. Additional focused
RED runs exposed lost provenance, missing target CAS, stale cancellation,
mislabelled compensation, escaped quote matching, ignored cancellation, and
known failures misreported as uncertain. Each was corrected before its focused
entry passed. Immutable G1 old-code recipes and release samples are unchanged.

| User invariant | Implementation and executable evidence |
| --- | --- |
| A confirmed effect changes the named real object, or explicitly records no object change | `kernel-effects.ts` uses existing domain constructors and repositories. `kernel-effect-matrix.test.ts` covers all six effects across absent, skipped, successful, invalid, timeout and uncertain assessment paths. `kernel-evidence-links.test.ts` exercises the canonical Evidence plus both relation families. |
| Only a live user session can approve this preview | `kernel-application.ts` resolves an opaque capability through the trusted application session; payload actor labels never resolve authority. `kernel-http.test.ts` exercises actual authenticated HTTP and rejection of generic acceptance. |
| Object, terminal, event, head, command and Receipt stay atomic | The existing G3 UoW remains the transaction owner. The effect matrix injects failures at each canonical write boundary, including rollback of direction-change invalidations. Workflow integration covers conflict preservation, supersession, resolution, compensation and lost-response lookup. |
| A restart never sends or guesses the outcome | The actual application subprocess is killed after durable running and before a response. `kernel-application-crash.test.ts` reopens as uncertain with zero sends. Provider-boundary tests cover failed response persistence and immutable correction children. |
| The approved bytes are the sent bytes | `kernel-transport.test.ts` runs the production adapter against synthetic loopback TCP fixtures: exact body, disconnect, timeout, redirect refusal, invalid/oversized response and zero connections after revision/configuration drift. |
| Assessment facts never assert semantic correctness | The four independent flags, Provider identity and bounded structured opinion survive restart. Substantive remains a Provider label. Quotes are matched to selected text, not JSON keys; neither valid syntax nor quote location creates support. |

The two existing downstream domain entries `findings.test.ts` (8 assertions)
and `availability.test.ts` (4 assertions) now use the real persistent application
path and pass. Their original behavior claims remain; positive generic
acceptance cases now supply an explicit typed effect. Both files are also in
the foundation gate, so these repaired contracts cannot silently regress.
The three domain assertions in `remaining-findings.test.ts` remain assigned to
G7/G10/G12; seven built-UI assertions remain assigned to G6/G7/G9. Their prior
RED evidence is reused; unrelated later-gate failures were not rerun.

No renderer, layout, route UI, native dependency, installer, migration switch,
release tag or publication changes are part of G4/G5. Actual built-server
verification remains in the public gate; the previous three-platform artifact
matrix is not repeated. No real Provider or user project is used.

The final integrated `pnpm verify:public` passed with exit code 0 on
2026-09-07 at `85beaade435f8c5bf5eb52910a2017acbf43d98c`, in the existing
clean verification checkout. It passed production lint/types, all 330 selected
production regressions (including the real built Research Room entry), all 10
G0 contract/state files, immutable recipe/schema/discovery checks, all 308
foundation/application assertions in 33 files, documentation, repository,
architecture and public-history checks. No test in these full runs was skipped.

The first full integration attempt stopped at one exact-envelope expectation
(305 other foundation assertions passed). After the fix and the discriminating
source-binding regressions below, the final committed runtime passed the full
gate. This was a failure-driven rerun, not an additional independent audit or
platform matrix. Final completion/handoff prose receives only document and
contract/status checks; the verified runtime is unchanged.

G4 and G5 are `completed_and_verified`. There is no remaining scope blocker.
The next gate is G6; no G6–G13 completion is claimed.

| G4/G5 implementation history | Contribution |
| --- | --- |
| `21abc0b` | Persisted effect and independent assessment-fact behavior RED before implementation. |
| `72eae64` | Typed six-effect Kernel, durable Review/attempt orchestration, exact-byte production adapter, session-protected application API and integrated executable coverage. |
| `85beaad` | Explicit foreign-Issue-target and partial-Evidence-binding rejection, complete assessment-envelope expectation, and final fully verified runtime. |

The integrated run also exposed an outdated exact-envelope assertion after the
new identity/authority metadata was added. Its expected object now includes all
new fields while retaining every original flag assertion. Final focused source
binding tests additionally reproduced an Issue preview accepting a foreign
project's target, and a partial Evidence binding being silently discarded by
the reusable legacy decoder. The typed boundary now rejects both before preview
confirmation. These fixes affect the new effect parser/builder only.

## G6/G7 application, privacy and visual evidence

The G6/G7 branch is `codex/post-0.2-g6-g7`, based on G4/G5 completion
`7a8a3cb`. Implementation commit `f17fd7f6fc4012ca674d16a9fc312a13736458dc`
adds the real application paths; `4714bb20fed6a79f0f4fa773b05b1f4090230d17`
fixes conflict-field copy and separates transport response tests from the
deliberately silent timeout fixture. Both retain the existing Kernel, canonical
transaction, persistent Review and authenticated application dispatcher.

| User result / invariant | Executable evidence in `tests/post-0.2/foundation/` |
| --- | --- |
| A question or task starts a native Brief; 13 fields retain provided, intentionally empty and missing states. Typed thresholds do not invent legacy meaning. | `progressive-brief.test.ts` |
| Current-project object selection and effect-scoped Coverage use one snapshot; stored Manifest and exact request bind the same complete Coverage. | `progressive-brief.test.ts`, `brief-coverage-binding.test.ts` |
| Candidates survive reload; an intervening commit requires three-way choices and a fresh unchecked preview confirmation. | `production-ui.spec.ts`, `production-workflows.spec.ts` |
| Derived Brief publication is recoverable and cannot overwrite unknown files or become a second source of truth. Missing-file repair explicitly validates the migrated database. | `brief-publication.test.ts`, `brief-repair-http.test.ts`, `production-workflows.spec.ts` |
| Original assessments and Findings remain immutable; four correction actions create linked work. A second opinion is isolated and optional; only the child's canonical result closes the correction. | `review-correction.test.ts`, `correction-finding-path.test.ts`, `production-workflows.spec.ts` |
| Memory source, expiry, sensitivity and send policy are enforced before selection. Recall never implies selection or Evidence. | `kernel-memory.test.ts`, `memory-source-lifecycle.test.ts` |
| Forget removes controlled local bodies without changing historical hashes; failures roll back the canonical privacy transaction, while later filesystem failures retain resumable cleanup and do not restore text. | `privacy-transaction.test.ts`, `legacy-memory-forget.test.ts`, `privacy-maintenance.test.ts` |
| Managed backups can be deleted or explicitly retained with restore blocked. Unknown copies are reported as blocked, never overwritten or counted as removed. | `privacy-maintenance.test.ts`, `downgrade.test.ts`, `production-workflows.spec.ts` |
| Draft bridge capability is separate, expiring and revocable, including uploads in progress; wrong project, oversized content and old tokens cannot create drafts. | `host-draft-intake.test.ts` |
| Old Appeal, Room and Pilot states retain read/export and idempotent source-linked conversion; old writes are rejected by the application server. | `legacy-states.test.ts`, `production-workflows.spec.ts` |

The fixture source, Schema and hashes remain pinned to old code. All 49 existing
legacy-state samples were also exercised through the actual application API;
the new HTTP assertions use the already verified complete sample cache. The
optional cache setting does not weaken hash verification or mutate those files.
Agent Corrector's bounded generator checks, companion handoff and negative
authority tests passed; no model-quality evaluation was substituted for them.

Behavioral failures were observed before the affected implementations: native
minimal Brief creation, incomplete Coverage accepted as bound context, missing
derived-file recovery, historical body retention after Forget, and application
Receipt loss after reload. Their fixed assertions exercise canonical objects,
actual persisted state or real application requests rather than test-only
helpers. The G1 discovery now closes P1-04 through the typed built editor and
P2-01 through Finding selection and the linked correction result. P1-06 remains
G9 RED; P2-02 remains G10/G12 RED. Their independent commands and assertions are
retained and were not rerun as unrelated failures.

### Built interface and running motion

The existing Product Design review workflow and motion references were applied
to the actual built Research Room. Manual browser operation covered typed Brief,
Decision, Evidence and Issue commits, saved results after server restart,
context use/Forget and the context drawer. The built browser suite operated 12
complete scenarios, all passing, including Chinese/English with light, dark and
high-contrast themes, desktop widths, 200% text, keyboard/focus, long content and
22-entry pagination. It also operated correction/second-opinion unavailability,
uncertain recovery without resending, Host enable/revoke, historical export and
conversion, missing-file repair, and competing Brief candidates. Actual rendered
screens were inspected, including empty, error, stale, uncertain and saved states.

Observed visual defects were fixed in the affected components: drawer height
and scrolling, duplicated context introduction, confirmation focus after Forget,
the creation form remaining open after save, 200% header-button overflow, and an
internal reference-field label in the three-way comparison. The latter's final
focused built-browser run passed after the copy repair. The conflict screenshot
now captures the full comparison section rather than only its heading. Key
screens are retained as local test output, not committed research or build state.

The drawer was operated through opening, closing, rapid reversal and Escape.
Live browser frame samples observed translation approaching zero over roughly
212 ms and opacity reaching one, followed by a stable end state. Reduced-motion
operation had zero transition duration and retained keyboard/focus behavior.
There is no claim of 60 fps or general performance improvement. No extra motion
framework, simulated success or automatic network retry was introduced.

Copy now distinguishes saved drafts, saved research changes, uncertain sending
and retained backups. For example, `ledger_only` is presented as “尚无模型评估” /
“No model assessment”; `objectReferences` is “关联研究对象” / “Related research
objects”. Backup retention explicitly says that forgotten content may remain in
those files and that restoration is blocked. Provider-received content and manual
exports remain outside the controlled local cleanup boundary.

### Integrated verification

The first full public run passed 331 selected production regressions and 340 of
342 foundation assertions, then stopped on two real-transport cases whose shared
150 ms fixture deadline expired before the loopback server observed a body.
The same eight transport assertions passed in isolation. The fixture now uses
a distinct bounded deadline for its intentionally silent responder and allows
the response-content cases to reach the responder under load. Exact bytes,
one send, terminal status, restart without resending, and zero sockets for stale
bindings remain asserted. This is a failure-driven rerun, not a weakened gate.

Final `pnpm verify:public` passed with exit code 0 on 2026-09-07 at
`4714bb20fed6a79f0f4fa773b05b1f4090230d17`, using the existing clean verification
checkout. It passed 331 production regressions in 40 files, 342 foundation and
application assertions in 46 files, all 10 G0 contract/state inputs, immutable
fixture/discovery/Schema checks, production lint/types, repository, documentation,
architecture and public-history checks. No tests in those full runs were skipped.
The separate 12-scenario built-interface suite passed; the final copy-only repair
also passed a rebuilt focused conflict scenario. Final status/evidence prose
receives only documentation and contract/status checks.

Affected native file publication, privacy cleanup and restore refusal were tested
on Windows x64 with synthetic projects and real database/filesystem operations.
No installer, native dependency, Electron assembly, release archive or published
artifact changed; the previously verified three-platform release matrix was not
repeated. No real Provider or user research project was used. G6 and G7 are
`completed_and_verified`, with no remaining scope blocker. G8–G13 remain
unimplemented; the exact G8 entry is in
[operations](G1-G3-OPERATIONS.md#exact-g8-continuation).

## G8/G9 application, projection and visual evidence

The 2026-09-08 handoff began at `5041e3c0d1cf9f04964c5cacbfbe1ae4c9ed29ee`
on `codex/post-0.2-g6-g7`, then continued on `codex/post-0.2-g8-g9`.
The existing uncommitted asynchronous open/close fix and lifecycle test were
inspected, extended and verified. Unrelated `.gitignore`, lockfile and local
reference/execution materials were retained. No release, push or tag was requested.
The G0–G7 sections above remain historical evidence, not a fresh claim about
this implementation. The released baseline remains v0.2.0/schema 20.

The implementation map and failure contracts are in
[G8/G9 decisions](IMPLEMENTATION-DECISIONS.md#g8g9-implementation-decisions),
and the actual application/route entry is in
[operations](G1-G3-OPERATIONS.md#g8g9-candidate-application-and-read-ports).

| Behavior and actual failure | Verification |
| --- | --- |
| Closing a pending open could leave a usable session; persistence failure during close could leave the real lease held | `kernel-api-lifecycle` (5) and `kernel-close-failure` (1) verify generation revocation, real database lease reacquisition, cancellation and restart uncertainty. The close-failure assertion was RED before the finally-based resource release. |
| Same integer head incorrectly marked changed workflow/cached bytes current | `projection-identity` (5) produced real REDs for saved-draft invalidation, stale rebuild publication and corrupt cache data, then GREEN. It also covers expiry without database writes, same-revision restore with different contents, hash-valid JSON tampering and preserved outbox. |
| Views and restored navigation could disagree | `workspace-projections` (3) compares all seven surfaces and full Resume/Review detail against one input identity, verifies actual Receipt/revision, command result, durable restart and explicit rebuild without changing the canonical head. A real saved Brief scope phrase initially returned no search result (RED); the explicit research-field allowlist now includes structured Brief boundaries (GREEN). `workspace-recovery` (2) uses two actual SQLite connections and a stale restore preview. |
| Focus refresh and late save responses lost or resurrected text | `review-draft-preservation` runs the actual built application with a held save acknowledgment, later typing, focus/reload, leave save/discard/cancel and browser back. `draft-buffer` (2) includes the RED late-acknowledgment-after-privacy-removal case. |
| Old creation URLs and composite relation links were incorrectly accepted/rejected | HTTP old Appeal/Room creation returned 200 before the 410 fix; `kernel-http` verifies the refusal with and without Provider. `kernel-route` exposed a composite relation becoming `not_found`, then verified the fix. `g9-large-project` opens the actual relationship result via keyboard from its type filter. |
| Exact request/result/session boundaries | Existing six-effect, provider, compensation, privacy and legacy regressions remain enabled. `g9-read-isolation` holds a real SQLite-backed old HTTP response while a newer search completes, then closes and reloads the session. The stale result cannot appear. |
| First use and recovery | `kernel-start` verifies real candidate creation, unknown-store preservation and read-only mutation refusal; `workspace-recovery` verifies current-pair-bound restore confirmation. Existing migration, privacy and missing-file repair paths are retained. |

The foundation browser command operates the real built candidate, real Kernel and
isolated SQLite projects. Its integrated run passed 21 scenarios. After visual
refinement the 12 affected theme/workflow scenarios passed again; the additional
large-relation and delayed-query journeys passed separately. P1-06's corrected
actual-candidate target passed all six language/theme/200%-text scenarios with
four-entry and no-implicit-network assertions intact. Missing Electron and
unrelated-source tag checks both still fail in their separate G10/G12 command;
neither was skipped or reported closed.

### Visual, interaction, motion and copy observations

Product Design's audit workflow was used against the existing Quiet Instrument
system, first on the real existing application and then on the rebuilt candidate.
No generated design image replaced acceptance. Actual renders inspected include
Start Center, Today, Project, Brief detail/edit/conflict, Search, Settings and its
dialogs, History/export, new Review, saved Review/result, correction, uncertain
restart and contextual Memory/Forget. English and Chinese, light/dark/high-contrast,
1100/1280/1440/1920 widths, long text/lists and 200% text were exercised. Shared
surfaces reuse their verified states rather than duplicating a report per card.

Observed defects were corrected: stretched narrow-desktop navigation, an oversized
long-Brief heading, missing dialog focus return, stale history response replacement,
composite relation navigation, and an 8,099-character Finding filling a select
option. The final Finding option is a short excerpt, with the full original text
available separately; no request bytes are changed. The large Provider error case
remains an honest uncertain outcome without raw exception text leaking into UI.

Manual browser operation covered opening Project, opening/closing the context
drawer repeatedly, Escape focus return, Tab inside the drawer, the inaccessible
background while the native dialog is open, and the real appearance control with
reduced motion on/off. Runtime frame samples additionally observed the entrance
transform moving to zero and opacity to one, quick reversal without queued replay,
and no transition under reduced motion. Slow save response behavior was exercised
by retaining the real server result until newer input existed. No synthetic progress,
simulation of thinking or success before a real saved result is used.

Representative copy is now “保存草稿 / Save draft”, “查看修改 / View changes”,
“草稿已保存，后来输入的文字尚未保存。 / Draft saved. Your newer text is still
unsaved.” and “外发结果不确定 / Send outcome uncertain”. Recovery distinguishes
saved data, read-only browsing, recheck required and retained backup copies.
Necessary hashes and internal details stay in collapsed inspection sections.

Local test evidence is under the ignored `.tmp/g8-g9/` directory (build, public,
targeted performance, UI and deferred-RED logs, raw performance samples and selected
screens). These synthetic browser renders are not Electron installation evidence.
The final gate results and measured values follow below.

Selected actual renders retained with this record:
[Chinese Today](evidence/g8-g9/today-zh.png),
[200% text and high contrast](evidence/g8-g9/review-200-percent.png),
[large-project search, second page](evidence/g8-g9/search-large.png),
[long Brief with bounded heading and full content](evidence/g8-g9/brief-long.png),
[full long Finding behind a compact selector](evidence/g8-g9/finding-full.png).
The final built browser was also manually opened against a missing synthetic
folder (honest error, input preserved), then opened read-only (new-review route
offers browsing only), closed and reopened through its recent-project entry.
The final long-Finding/uncertain/correction Chinese journey passed again against
the build containing `025f7f2beed6649d2da64997bddb4dee8e2acc82`; its actual
expanded Finding screenshot was opened and inspected before retention.

### Final G8/G9 verification — 2026-09-08

The final verified source is `089c2ee4e16f52e1951c2f016023773e4b3278b1`, comprising the implementation
commit `26ae039`, the structured-Brief search fix `025f7f2`, and the repository
archive classification fix `6af31be`, followed by the actual Brief-detail
search/deep-link fix `156c590` and unified heading/layout refinement
`089c2ee`. Both final gates exited 0:

- `pnpm verify:public`: 331 production regressions, 364 foundation/application
  assertions in 55 files, frozen contracts, immutable fixtures/discovery/schema,
  production lint/types, repository/document/architecture/history checks.
- `pnpm verify:platform win32 x64`: native foundation, two identical deterministic
  preview archive builds, exact artifact verification and clean-extraction
  start/reopen/upgrade/backup/restore/failure/future-schema/restart/uninstall/reinstall.
- Additional actual-browser results: integrated 21, affected refinement 12, P1-06
  six, large relation one, delayed-query/session one, final affected visual two,
  final Chinese long-Finding/correction/uncertain one, and final Brief search/detail
  plus delayed-query two; shared journeys are reused
  and these counts must not be added as unique independent scenarios.
- Repository file-type regression: 16 fixtures passed. A synthetic wheel archive
  actually failed before the classification fix; product source containing NUL
  still fails afterward. User reference materials were neither removed nor exempted
  by directory name. Wheels use the same binary ZIP format already allowed by
  this text-file check; all product import/security/history scans remain enabled.

Earlier complete runs failed real next-page performance assertions (469 ms and
406 ms against 400 ms); reusing already validated immutable snapshot ownership
removed redundant whole-state cloning/hashing without dropping integrity checks.
A later run caught the actual Brief search omission, corrected and independently
verified before the final run. Another complete run reached repository checking
and rejected two local wheel archives as text; the boundary regression above
fixed that false classification. The final manual search journey then exposed
a Brief result displaying only technical data; a built-browser assertion failed
before reusing the full Brief panel. Search-to-detail and refreshed deep links
now pass and the actual corrected English and Chinese renders were inspected.
The visual follow-up also exposed duplicate headings; the one-primary-heading
assertion failed before the shared layout correction, then passed. The in-flight pre-fix
public run was stopped and restarted against the final source. None of the
failed or interrupted runs is reported passed.

Performance corpus seed `920000` contains at least 1,000 canonical research
objects, 500 relationships, 1,100 persisted Reviews (including 1,000 migrated
records and 100 native Reviews), 1,000 legacy history records, at least 300
Attention candidates, 50 Memory records and long Chinese/English Brief bodies.
Conditions: Windows x64 10.0.26100, Node 24.13.0, pnpm 11.19.0, AMD Ryzen 9
8945HX and approximately 31.05 GiB RAM. Real SQLite reads use a freshly seeded
project after its initial validation read, 25 sequential samples per operation;
serialization has 75 samples (three views per iteration). p95 uses nearest rank.

| Operation | Final public-run p95 (ms) |
| --- | ---: |
| Consistent database snapshot | 293.70 |
| Today including database read | 304.84 |
| Project including database read | 300.01 |
| Search including database read | 304.20 |
| Search next page including database read | 302.81 |
| Pure projection | 13.18 |
| Page JSON serialization | 0.38 |
| Explicit validated rebuild | 617.88 |

The platform gate's independent samples also passed all unchanged page thresholds
(next-page p95 262.69 ms). Raw samples remain in
`.tmp/g8-g9/performance-public.json` and `performance.json`; final command logs
are `verified-public.log` and `platform.log` in the same local evidence directory.
The actual large-project browser opened Today in 2,852 ms in its recorded journey;
that single measurement is not a cold-start p95 claim. No packaged Electron
performance, macOS/Linux revalidation, real-Provider semantic result or new release
is claimed. The Windows gate exercises the existing preview artifact, not an
Electron installer. G8/G9 have no remaining blocker; G10 starts at the exact
continuation in the operations record.

## G10/G11 internal desktop evidence

This is partial implementation evidence, not a G10/G11 completion or public
release declaration. G8/G9 completion remains unchanged. Work started at
`17a59be0fac31b59d25f890591b26e6889638e8d` on
`codex/post-0.2-g10-g11`. Commits `615f27c` and `16d542c` introduced the
real desktop candidate and initial installation recipe; `7f54d2c` fixed lifecycle,
transport, MCP and installed layout behavior; `5490837` distinguishes irreversible
Forget from retaining managed copies in trusted confirmation. The inherited
`.gitignore` edit, retired lockfile importer cleanup and user reference directories
were preserved separately. No push, tag, public release or signing account was used.

Environment: Windows x64, host Node 24.13.0, pnpm 11.16.0. Real Electron 44.3.0
reports Node 24.20.0, Chromium 152.0.7977.78 and SQLite 3.53.4. The runtime probe
requires Electron's browser process and fails host-Node substitution. It imports
Core, performs real SQLite transactions, closes/reopens, persists a Kernel draft
and exercises the available OS encryption backend. This is Electron runtime
evidence; it does not by itself establish installer or native-dialog acceptance.

| Capability statement | Implementation / actual evidence | Limit |
| --- | --- | --- |
| One research workflow in a bundled window | `apps/desktop`, neutral `packages/application`, browser-safe `packages/application-ports`; actual IPC and installed journeys use Kernel/SQLite | No public default switch; schema 25 remains the candidate |
| Renderer claims cannot authorize a research write | `TrustedKernelCommands`, `tests/desktop/ipc.test.ts`, `foundation/desktop-authority.test.ts`; declined, expired and revoked confirmation preserve the Review | Automated OS answers are explicitly test stubs, not native-dialog usability evidence |
| Closing/crashing revokes resources | Actual renderer crash reproduced a close-guard deadlock; corrected teardown passes. Old session edits fail after reopen; draft survives | Full suspend/platform lifecycle matrix remains open |
| Exact Provider bytes reach only a validated connection | `provider-transport.ts`, `tests/desktop/network-probe.ts`; real Electron TLS, exact body, pinned address, mixed-DNS denial, wrong-certificate rejection, final-guard-before-write, no implicit proxy | Synthetic DNS/HTTPS only; no real research Provider or metadata endpoint contacted |
| Uncertain results never automatically resend | TLS redirect creates durable uncertain attempt; successful request completes; reopen sends nothing | Not a model-quality claim |
| Deleting/recreating Provider configuration cannot revive an old binding | Persistent configuration-generation high-water mark; delete/restart/recreate regression passes without changing project revision | Legacy configuration/credential migration is not complete |
| MCP sees current research while desktop writes | `readKernelProjectContext`, actual writer-held snapshot regression and MCP boundary tests | Standalone installed MCP launcher/companion packaging is not complete |
| Native words distinguish privacy actions | Actual failing Forget/retire tests turn green; selected Memory/version and irreversible consequence are shown; retained files are explicitly not deleted | Native OS dialog layout/focus/motion still needs acceptance |
| New terminology does not reintroduce old permission semantics | `tests/desktop/terminology.test.ts` checks new desktop/adapter code with executable positive/negative examples and bilingual copy against frozen claims | It intentionally preserves legacy readers, samples and canonical Decision status enums; it is not a semantic-quality evaluator |
| Internal update status is truthful | Actual installed About page says source unavailable; signed-identity tests reject tampering/replay/wrong platform/unknown root | Download/staging/backup/install orchestration is not complete |

Behavioral failures are retained locally under `.tmp/g10-g11`: renderer-crash
close timeout, stale MCP WAL read, narrow-window content gap (131 px against a
64 px limit), visible accessibility legend, generic Forget wording and missing
retire/delete distinction. These were actual runtime/state/copy failures, not
missing-symbol or missing-tool failures. Redirect uncertainty and browser-blocked
port 6679 were also corrected. An OpenSSL fixture setup failure and a strict lint
failure were setup/check failures and are not counted as behavioral RED.

The shared public gate passed on `7f54d2c` (331 production tests and 372 foundation
tests plus its contract, lint/type, repository, documentation, architecture and
history checks). The subsequent native privacy-confirmation refinement has its
own failed/green evidence and requires the final runtime gate recorded below.
An in-progress platform run observed the new retirement assertion before its
adapter fix was available to that worker; that run failed and is not evidence of
platform completion. Generated builder diagnostic YAML was moved into private
build staging; repository checks and content rules were not weakened.

The earlier Windows installer `0.2.0-g10.16d542c6` was really installed, used,
exited/reopened, double-launched, uninstalled, and reinstalled in an isolated
directory. The original synthetic database remained byte-identical across
uninstall and its saved draft was readable after reinstall. Two fresh staging
builds of that source produced the same unsigned-core SHA-256
`c6fa439e91aa0562ee16057eb82e95c1502ddee96ee719837e8e9016b12c493bb`.
Those are preliminary-candidate results, not the final corrected installer.

Product Design review used actual installed Electron window captures, not browser
screenshots. English/Chinese × light/dark/high-contrast journeys used widths
1100/1280/1440/1920, 200% text, long synthetic content, keyboard navigation, dirty
text protection, drawer Escape/focus return, rapid open/close, reduced motion,
unavailable updates and a no-Provider decision saved through real Kernel. Screenshots
were opened and inspected. The narrow-layout gap and visible screen-reader legend
were found visually and fixed, with actual Electron layout regression evidence.
The native picker and final confirmation were stubbed only inside those test
processes; neither these stubs nor static screenshots count as native-dialog or
observed animation acceptance. The native Computer Use helper reported a stopped
session, including after the user's authorization to continue. No further native
app input was sent through that stopped helper. Native focus and observed motion
remain unverified rather than inferred from automated assertions.

macOS arm64 and Linux x64 machines, public signing/notarization resources and
production update trust were explicitly unavailable. No old platform pass,
cross-compilation, self-signing or mock is substituted. Independent remaining
implementation (updates, credential migration, full schema-25 backup/upgrade
integration and installed failure matrix) is listed separately in the
[exact continuation](G1-G3-OPERATIONS.md#current-desktop-entry-and-remaining-g10g11-work).
G10/G11 are `current_partial`; G12 is not active.

### Final local candidate verification (2026-09-12)

The final runtime is `5490837bc633d632c08f01060740b654e9d4280b`, tree
`2390d144180bdd7f0b02cc08f10a184de2079b13`. Subsequent changes only refine the
test harness/terminology checks and this evidence; they do not change the installed
runtime. The Windows installer is
`release/desktop/win32-x64/Sestina Candidate Setup 0.2.0-g10.5490837b.exe`
(111,835,941 bytes), SHA-256
`d508cb36c498ed0fc7a3ed99b50ba78106177fd40e94b887158e42bee3604107`.
Its actual installation remains in `.tmp/g10-g11/installed` for local inspection.
Both executable and installer report **NotSigned**, never a trusted public signature.

- Final `pnpm verify:public` passed: 331 production tests, 373 foundation tests,
  and every shared gate. Log: `.tmp/g10-g11/verify-public-final-runtime.log`.
- Final `pnpm verify:platform win32 x64` passed: 373 native foundation tests,
  two deterministic **preview** builds, exact preview verification, and the
  preview's clean extraction/upgrade/recovery/no-network/uninstall journey.
  Log: `.tmp/g10-g11/platform-windows.log`. This remains a preview platform check;
  it does not masquerade as Electron installation coverage.
- Actual installed candidate: 11 desktop tests in six files passed, followed by
  the two affected IPC tests with additional real foreign-window sender rejection,
  renderer CSP denial, protocol 403 and new-window denial. Logs:
  `final-installed-desktop-tests.log`, `final-installed-ipc-sender.log`.
- Real Electron TLS: two exact HTTP requests across four observed TLS sockets
  (including final-guard cancellation and wrong-certificate rejection); actual
  Kernel states `completed` and `uncertain`; restart sent nothing. The explicit
  test certificate is synthetic and TLS verification remains enabled.
  Log: `electron-network.log`; runner: `scripts/verify-desktop-network.mjs`.
- Two fresh final staging builds produced identical unsigned-core SHA-256
  `31e2dad013dca3b1d5a6c2ed9da23ac0ac86b409fbb180b95a47f178f7d0d56d`.
  Actual ASAR verification checks 11 allowlisted files, identity, migration/lock/
  Logo source hashes and Windows PE architecture. The same installed positive
  passes while actual source, platform and main-bundle hash mismatches fail for
  those mismatches. Logs: `final-reproducibility.json`, `final-artifact.log`,
  `final-artifact-negatives.log`.
- Final installation, reopen, double launch, uninstall and reinstall passed.
  Uninstall removed the executable while retaining the original synthetic
  `state.sqlite` hash
  `b90041027c8f27961cce743cbcbfab79f4b5be4b39ec39d6a5b3376dc21b7f64`.
  Reinstall read the original project identity and saved text. Logs:
  `final-install.json`, `final-install-reopen.log`, `final-uninstall.json`,
  `final-reinstall-reopen.log`. Full desktop upgrade-failure acceptance is still
  a separate open requirement.
- Final installed six-language/theme journeys passed and produced 25 real window
  captures under `.tmp/g10-g11/installed-visual`. The capture harness now waits
  for actual Chromium presentation; a prior capture batch included preceding
  compositor frames and is retained as diagnostic, not accepted final imagery.
  Viewed final frames include English light Today at 1100, Chinese dark Review
  at 1440, Chinese/English high-contrast Review at 200% text, English saved result,
  English dark About and Chinese light About at 1920. Narrow spacing, hidden
  accessibility legend, vertical reflow, visible focus and persistent unavailable
  update feedback were confirmed from these images. Rapid drawer cancellation,
  Escape/focus return and reduced-motion operation passed automated interactions.
  **Observed native motion, OS dialog focus and native installation screens have
  not passed visual acceptance.** The OS stubs and automation cannot replace them.

Read the existing operation record for the exact remaining implementation and
platform resources. These passing local results do not close G10/G11, authorize
G12, switch the default, or validate signed/public three-platform installers.

### Continued G10/G11 local verification (2026-09-12)

This continuation supersedes the previous candidate's remaining local
implementation list, without changing its historical evidence. The runtime
source is `0c33aad574d4368996ab09e020459f4c218d87f4`, tree
`24b16d89c86095eb6737ee24d47323fd4c30a86f`. Later evidence and test-launcher edits
do not alter the installed runtime. G0–G9 stay complete; G10/G11 remain partial
for the exact acceptance limits in the [current mapping](G1-G3-OPERATIONS.md#current-desktop-entry-and-remaining-g10g11-work).

Implemented and connected to the application:

- Core schema-25 managed recovery validates canonical revision/hash, Brief,
  workflow/event chain and privacy identity. It creates verified pre-restore and
  pre-upgrade bundles, binds single-use confirmations to the session and current
  files, holds shared maintenance/writer locks and blocks retired or
  privacy-incompatible restores. Interrupted pair replacement and cleanup retain
  an explicit recoverable marker; unknown replacements remain refused.
- Desktop start-page backup/recovery and earlier-settings import/export use the
  shared application service. Legacy configuration migration renews generation,
  verifies native credential read-back before publication, preserves source
  copies and resumes explicit partial migration without replacing newer user
  preferences or resurrecting deleted configuration. Explicit session-only keys
  clear on project close, suspension or exit.
- The manual updater implements installed-root verification, monotonic identity,
  bounded metadata/artifact downloads, private staging and phase records,
  cancellation, restart without retry, pre-upgrade project backup, verified
  physical program preservation, installer launch and previous-program recovery.
  Production roots remain empty. Synthetic constructor injection supplies only
  isolated test offers; there is no application trust override or publication.
- Installation resources include a dedicated Node 24.13.0 runtime and license,
  read-only MCP, canonical generated companion Skills and platform native
  credential modules. Settings exposes exact installed JSON/TOML commands.
  Native modules are copied outside ASAR and verified byte-for-byte.
- Bilingual operation/failure copy and current capability documentation are
  synchronized. Semantic tests reject obsolete generic effect kinds while
  preserving legitimate accepted Decision state and immutable legacy language.

The behavioral RED/repair sequence included missing credential read-back,
application maintenance/Brief-repair interleaving, preference root junctions,
interrupted preference migration overwriting a later user choice, and interrupted
post-commit restore cleanup. Current recovery tests also cover stale/replayed
confirmation, changed backups/current files, failed pair replacement, explicit
rollback recovery, writer contention and Forget protection. These tests pass.

Actual packaging/installation exposed three additional failures that development
source checks could not close. The builder rewrote native package metadata inside
ASAR; native resources were moved to byte-preserving extra resources. Electron's
virtual ASAR filesystem prevented physical program backup; a real Electron RED
probe now passes using its physical filesystem without global ASAR mutation.
Finally, ESM native import ignored the packaged CommonJS search path, so installed
DPAPI migration returned `credentials_need_input`. The bundle now resolves native
adapters through its installed CommonJS entry, and the real installed migration
passes. Public-gate failures also caught two unregistered foundation tests and a
desktop-to-secrets architecture violation; discovery was registered and the
adapter routed through Core's public factory. No gate, policy or frozen corpus
was weakened to obtain a pass.

Final verification and local logs (all log names below are under `.tmp/g10-g11`):

| Verification | Actual result and scope | Evidence |
| --- | --- | --- |
| `pnpm verify:public` | Passed 331 production tests, 384 foundation tests and all lint/type, contract, discovery, architecture, repository, documentation and public-history gates on final runtime source. | `public-final.log` |
| `pnpm verify:platform win32 x64` | Passed 384 native foundation tests, two deterministic preview builds and preview extraction/start/upgrade/recovery/no-network/uninstall/reinstall. This remains the published-preview platform gate, separate from Electron acceptance. | `platform-final.log` |
| Installed desktop suite | 23 tests in 10 files passed. Includes real installed DPAPI migration/read-back, session/IPC/CSP/sender rejection, saved project/MCP reads, schema-25 recovery, suspend/crash fences and updater/program-copy failure tests. Native confirmation and picker answers inside these test processes are stubs. | `desktop-final.log`; `tests/desktop` |
| Real Electron network probe | Two exact requests over four observed TLS sockets; Kernel completed/uncertain outcomes; final guard prevented body send, wrong certificates and mixed DNS rejected, implicit proxy ignored, restart sent nothing. Synthetic local certificate only. | `network-final.log`; `scripts/verify-desktop-network.mjs` |
| Actual Windows upgrade | Final `63627711` → `0c33aad5` upgrade used the real NSIS executable, real schema-25 pre-upgrade backup and verified old-program copy. A failed pre-backup prevented installer launch. Restart reconciled to installed without another fetch; preserved previous executable actually opened. Earlier in this continuation `5490837b` also upgraded to `63627711`. | `upgrade-final.log`, `installed-upgrade-result.json`; `scripts/verify-desktop-upgrade.mjs` |
| Actual uninstall/reinstall | Silent uninstall removed the isolated executable and preserved the original synthetic database and Brief bytes. The session's native installer subsequently displayed progress and completion at the selected installation location. Actual installed-file verification, original draft reopen/double-launch and both IPC tests (including native credential migration and bundled MCP) passed there. | `uninstall-final.json`, `reinstall-reopen-final.log`, `reinstalled-ipc-final.log`, `artifact-installed-final.log` |
| Actual resource verification | 34 expected resources match source/tree, committed lockfile, schema/migration, official Logo, runtime and target. Wrong source/platform/main hash and actual native/Node byte tampering fail; restored bytes verify again. | `artifact-installed-final.log`, `artifact-negatives-final.log` |
| Independent clean builds | Two fresh staging directories produce identical unsigned-core bytes. Outer unsigned NSIS packaging is recorded separately. | `reproducibility-final.json`, `package-final.log`, `package-repro-final.log` |
| Installed visual journeys | Six English/Chinese × light/dark/high-contrast journeys pass at 1100×760, 1280×800, 1440×900 and 1920×1080; long content, 200% text, local saved decision, error/input preservation, rapid drawer cancellation, Escape/focus return and reduced-motion operation. No renderer network request. | `visual-final.log`, `installed-visual-0c33aad5/results.json` and 43 actual window PNGs |

Final installer:
`release/desktop/win32-x64/Sestina Candidate Setup 0.2.0-g10.0c33aad5.exe`,
135,367,605 bytes, SHA-256
`a5465d621f54bd9d23aa30880867ff33e4e459f128331888410c0786cfd84ac7`.
The unsigned-core SHA-256 from both independent builds is
`d76d8d792d30be58b19fae991fa8cbb10ad671d75069ac26a6051e89d3f3265c`.
The final executable and installer are **NotSigned** (`signatures-final.json`).
The actual selected installation location is kept in private local logs rather
than committed as a personal absolute path. The earlier isolated installation
was removed by the verified uninstall and must not be advertised as the final
executable location.

The preserved synthetic database SHA-256 is
`b90041027c8f27961cce743cbcbfab79f4b5be4b39ec39d6a5b3376dc21b7f64`;
the Brief SHA-256 is
`411a6d876c63deb7ed6f2bb49722f9842114a42b19a907e9d9c614ed8994ca0c`.
Original project identity and draft text were read after reinstall. No real
research material or Provider response was used in the acceptance fixtures.

Product Design inspection opened the final actual captures for English light
backup/Today/saved result, English high-contrast integration, Chinese light
invalid-settings import, English dark About and Chinese dark Review at 200%
text. An earlier capture showed adjoining start-page and MCP buttons. Their
spacing/wrapping was corrected using the existing design and then re-inspected
in the final installed images. Copy reports saved state, preserved input,
retained earlier settings, unverified host connection and unavailable update
source without elevating test, hash or model status into research authority.

Native Computer Use was retried in this continuation. An initial launch approval
timed out; later calls successfully observed and dismissed an installer error,
opened the actual retained program, opened the final candidate's real folder
picker, observed Tab's visible focus change, cancelled it with Escape and sent a
system close. Native installer progress/completion was also observed during the
session. This establishes those observations only. The helper repeatedly returned
stale focus data/control indexes, inconsistent screen/tree state and
concurrent-input/minimized-window guards; its product policy blocked the
uninstaller executable. Full native folder selection, credential/confirmation
focus, uninstall-wizard UX and continuously observed motion have **not** passed.
No substitute UI automation or static-image claim is used to close them.

One isolated upgrade attempt also failed because the acceptance process retained
the old ASAR archive handle. Reading the previous identity outside Electron
removed that test interference and the actual installer then succeeded. A desktop
build overlapped preview platform output replacement; its removed output was
rebuilt after that gate finished. Neither diagnostic attempt counts as a pass.

macOS arm64/Linux x64 systems, signing/notarization resources and production update
trust were not supplied. Their lifecycle and attack/credential matrices remain
unverified. G10/G11 are still `current_partial` with execution entry at G10;
G12/G13, public default, remote pushes, CI, tags and publication were not invoked.
Final record/launcher edits passed the documentation link check, frozen contract
verification, four targeted terminology/claim tests and diff whitespace check.
The launcher now accepts the actual installed executable path through the existing
SESTINA_TEST_INSTALLED_EXECUTABLE environment setting; the reinstall check above
exercised that path.

## G12 entry prerequisites, 2026-09-13

**Result: G10/G11 remain `current_partial`; G12 and G13 remain `not_started`.**
The user authorized G12 after its prerequisites and G13 after a real candidate
pass. Plan 14's G12 entry still requires completed G1–G11. This continuation
therefore performs G10 verification preparation and corrects stale records; it
does not execute G12 production acceptance or G13 default/legacy changes.

The one-time baseline check matched `codex/post-0.2-g10-g11` at
`f6b0c3addf9dfb76b0e431b2d7c457d01e8e8251`. The installed runtime remains
`0c33aad574d4368996ab09e020459f4c218d87f4`. Existing `.gitignore`, lockfile and
untracked work were preserved. The local execution-state record now labels
`5490837b` historical and points to the current runtime/handoff. Implemented
backup, update, credential migration and companion resources are no longer
listed as outstanding development. The current decision record's obsolete
updater statement was corrected without altering frozen plans or historical
evidence.

### Executed checks and unchanged artifact

`pnpm verify:desktop:readiness` is the narrow G10 prerequisite facility described
in [the desktop instructions](../../../apps/desktop/README.md#remaining-prerequisite-check).
It shares the existing actual installed-resource verifier, checks installer
bytes and source/platform-bound observations, and never launches an installer
or changes a gate. Its fixed remaining-case list covers native focus, continuous
motion, platform-appropriate uninstall interaction, other-OS lifecycle and
production trust. Linux signing follows the package format/provenance rule in
plan 10; Windows signatures are not imposed on Linux packages.

Four focused tests exercise complete synthetic binding fixtures and negative
cases: absent observations/platforms/files, replaced installer/evidence bytes,
wrong source/platform/installer identity, zero or missing cases, skipped/todo,
not-run/failed results, missing raw evidence and duplicate observations. The
initial test run failed before implementation; the implemented checker passed.
These synthetic tests validate the checker only and supply no native acceptance.
The public shared entry now includes them and syntax checks for both scripts.
One actual defect in the new CLI was reproduced in
`.tmp/g12-entry/stale-output-red.log`: malformed replacement inventory returned
exit 1 but left a prior successful output in place. The CLI now writes an explicit
failed result on that path. The affected four-test file and its typed lint passed
after the repair (`targeted-final.log`, `targeted-lint.log`); unrelated production
tests were not repeated. Scripts follow the repository's syntax-check policy.

The actual local inventory has **no completed remaining observations**. It
references only the existing Windows installer; macOS/Linux artifacts are absent.
The executed installed check verified all **34 resources** and the installer
digest matched. The combined prerequisite result was exit **1**, correctly
reporting 14 incomplete observation groups and two absent platform installers.
The proposed candidate/final/publish `verify:target` runner is still G12 work;
this result is not a partial pass of that production matrix.

| Local record/artifact | Actual scope/result |
| --- | --- |
| `.tmp/g12-entry/readiness-input.json` | Explicit `0c33aad5` source, exact Windows installer binding, no invented observations. |
| `.tmp/g12-entry/readiness-result.json` and `readiness.log` | Actual installed Windows source/resources passed; initial prerequisite evidence incomplete, exit 1. |
| `.tmp/g12-entry/readiness-current-result.json` and `readiness-current.log` | Final platform-appropriate requirement IDs, incomplete evidence, exit 1; unchanged installed-resource result reused from the preceding row. |
| `.tmp/g12-entry/public.log` | One shared public verification run passed, exit 0: 334 regressions across 41 files, 384 foundation assertions across 59 files, and all existing shared gates. |
| `release/desktop/win32-x64/Sestina Candidate Setup 0.2.0-g10.0c33aad5.exe` | Existing 135,367,605-byte unsigned internal installer; no new final/default package was built. |
| `release/desktop/win32-x64/candidate-manifest.json` | Source/tree, toolchain, schema 25, committed lock, migrations, Logo and resource inventory; `signed: false`. |
| `release/desktop/win32-x64/unsigned-core.tar.gz` | Existing independently reproduced core; its bytes were rehashed without rebuilding or replacing it. |

Installer SHA-256:
`a5465d621f54bd9d23aa30880867ff33e4e459f128331888410c0786cfd84ac7`.
Unsigned-core SHA-256:
`d76d8d792d30be58b19fae991fa8cbb10ad671d75069ac26a6051e89d3f3265c`.
Manifest SHA-256:
`3ddd39b8840d5ee99b95c9cf194819f581854d56c65b3a0575d9b297c8674f5d`.
Raw local paths/results are not committed. The prior 331 public/384 foundation,
23 desktop, actual Windows upgrade/reinstall, TLS and reproducible-core results
remain scoped to the [preceding runtime evidence](#continued-g10g11-local-verification-2026-09-12).
The preview platform gate was not rerun to fill missing desktop/platform evidence.
The shared run included the initial three prerequisite tests. The later
failure-output repair reran only the affected four-test file and its typed lint;
the shared script syntax checks also read the repaired CLI. Production/runtime
code did not change. The final evidence-only text received the document link and
whitespace checks without repeating public or platform suites.

### Native observation and exact blockers

The actual installed executable was launched with the supported Computer Use
API. The helper returned Sestina's title and Chinese start-page accessibility
tree, including folder selection and backup entries, but its screenshot showed
a different application inside the window frame. Activation then reported
`user input was detected in this window; call get_window_state before continuing`.
The requested fresh state still had inconsistent image/tree content. No click,
typing, substitute UI automation or unreliable-coordinate operation followed.
No screenshot of unrelated application content was saved as Sestina evidence.
The previously policy-denied uninstaller was not retried. This attempt establishes
a tool limitation, not a passed start page, native focus journey or motion check.

The outstanding resources are: (1) a supported native observation/input path
that returns consistent Sestina state, plus permitted actual observation of
credential/confirmation and uninstall interactions; (2) accessible macOS arm64
and Linux x64 systems with their real native credential/lifecycle facilities;
(3) authorized Windows signing, macOS signing/notarization and production update
trust/offer resources, with Linux package provenance/signing appropriate to its
format. The accepted Windows code needs no duplicate implementation. No remote
push, tag, CI, service provisioning or publication was attempted to obtain these.

### Consolidated stage index

This index preserves the complete task-card scope while merging repeated audits,
handoffs and full gates. None of the following G12/G13 rows is marked complete.

| Supplementary cards | Authoritative scope / existing evidence entry | Current disposition |
| --- | --- | --- |
| G12-01 | Plan 13 production acceptance and plan 14 dependencies; current prerequisite facility above | Formal nonempty target runner/index awaits G12 entry. |
| G12-02–G12-04 | Plans 01–05 and 11; G1–G9 foundation, frozen legacy corpus and migration/recovery records above | Existing lower-layer evidence retained; final production verification not executed. |
| G12-05–G12-07 | Plans 08, 10, 12 and 13; preceding installed IPC/TLS/privacy evidence | Full installed all-process network, exact outbound and security matrix not executed. |
| G12-08–G12-10 | Plans 06, 10 and 13; preceding Windows journeys and inspected frames | Full twelve-journey, installed performance, native accessibility and continuous-motion acceptance not executed. |
| G12-11–G12-12 | Plans 10, 13 and 14; preceding unsigned-core/artifact provenance plus current byte check | Three-platform signed candidate acceptance and cutover verdict blocked. |
| G13-01–G13-02 | Plans 11, 14 and 15; frozen legacy mappings and current release identity | No legacy-path removal or default/schema/release switch. |
| G13-03–G13-04 | Plans 10, 13–16; final affected-artifact verification and delivery rules | No final package, final acceptance, public tag or release. |
