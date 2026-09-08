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
