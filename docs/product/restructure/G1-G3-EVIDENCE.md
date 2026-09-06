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

## Status

G1 is in progress. G2 and G3 implementation and validation are not yet complete.
This record will be updated with actual evidence, not inferred completion.
