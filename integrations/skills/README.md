# `@sestina/skills`

This private workspace package owns two distinct Codex Skill choices. Both are
generated deterministically, but they serve different operating modes.

| Skill                        | Use it when                                                                                                                                              | Runtime dependency          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `agent-corrector`            | One agent needs lightweight protection against task drift, scope substitution, repeated audits, decision conflict, argument leaps, or evidence overclaim | None                        |
| `sestina-research-integrity` | The project has an active Sestina Research Brief and the host should read its bounded current context                                                    | Local read-only Sestina MCP |

## Lightweight `agent-corrector`

The installable Codex bundle is
`hosts/codex/agent-corrector/`. Copy that whole directory to
`.agents/skills/agent-corrector/` in the project where it should be available,
then reopen the project in Codex. It may be invoked explicitly as
`$agent-corrector`; its narrow description also allows implicit invocation for
non-trivial, drift-prone work.

Its rule is strict boundaries with flexible means: reason from the requested
outcome and causal constraints, then use only the amount of correction justified
by impact, uncertainty, and reversibility.

The Skill uses only context already visible to the current session. It has no
MCP, Sestina App, database, Provider, account, network, telemetry, background
process, or durable-memory dependency. It is guidance for the same acting
agent, not an independent watchdog or a guaranteed pre-action blocker. See the
[complete installation and behavior contract](../../docs/integrations/AGENT-CORRECTOR.md).

## Connected `sestina-research-integrity`

`canonical/research-integrity.md` is the hand-maintained body for the existing
MCP-backed Skill. Its project-scoped installation is
`.agents/skills/sestina-research-integrity/`. Metadata declares the local
read-only MCP server named `sestina`; it adds no write capability.

The companion CLI writes the project MCP block to `.codex/config.toml`. Codex
must trust the project before project configuration is loaded, and users must
reopen or restart the host after configuration changes. File status
`configured` is deliberately distinct from `hostVerification: unverified`.
Removing the generated Skill or MCP block does not remove Sestina Core data.

## Generation and evaluation

- `pnpm --filter @sestina/skills generate` refreshes both host bundles, the
  TypeScript constants consumed by the CLI, and the deterministic
  `agent-corrector` evaluation cases.
- `pnpm --filter @sestina/skills check` is read-only and fails when a generated
  artifact or evaluation case drifts.
- `pnpm --filter @sestina/skills test` covers the existing connected bundle,
  the standalone bundle, sensitive-data exclusions, and corpus invariants.
- `evals/agent-corrector/README.md` documents the bilingual development,
  locked, historical-regression, prompt, and scoring workflow.

Generated bundles contain no project Brief, project path, account, secret, raw
conversation, benchmark answer, or Provider response.
