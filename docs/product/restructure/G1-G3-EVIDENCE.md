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
this scope. G4–G13 remain `not_started`; their 15 domain and seven built-UI RED
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
