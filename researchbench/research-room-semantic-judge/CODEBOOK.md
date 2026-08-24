# Semantic Judge development label codebook

This is a synthetic development benchmark, not RI-35, external-user evidence, market evidence, or real second-use evidence.

## Categories

- `focus-substitution`
- `repeated-audit`
- `audit-hijacking`
- `semantic-scope`
- `decision-integrity`
- `argument-leap`
- `evidence-boundary`
- `shallow-abstraction`
- `substantive-argument-delta`
- `no-substantive-delta`
- `unknown-missing-context`
- `reasonable-increment`

## Variants

- `positive`: the named condition is present.
- `hard-negative`: a nearby but admissible case that must not be flagged.
- `boundary`: the supplied relation supports an honest unknown.
- `missing-context`: required context is absent and must produce unknown.

Every category has all four variants in zh-CN and English in both separated sets. `intervention` labels whether the system should prevent an unsupported reasonable-increment claim or foreground a conflict; user authority is never delegated. Label changes require a lock-change record and invalidate earlier results.
