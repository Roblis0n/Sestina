# `@sestina/skills`

This private workspace package owns Sestina's host-neutral research-integrity instructions and deterministic Codex artifacts.

- `canonical/research-integrity.md` and `canonical/agent-corrector/` are the hand-maintained sources for the two Skill families.
- `pnpm --filter @sestina/skills generate` refreshes the Codex host copy and the TypeScript constants consumed by the CLI.
- `pnpm --filter @sestina/skills check` is read-only and fails when a generated artifact drifts.
- The generated Skill contains no project Brief, project path, account, secret, benchmark, or provider data.

The project-scoped Codex installation is `.agents/skills/sestina-research-integrity/`. Its metadata declares a dependency on the local read-only MCP server named `sestina`; it does not add network access or write capabilities.

The companion CLI writes the project MCP block to `.codex/config.toml`. Codex
must trust the project before project configuration is loaded, and users must
reopen or restart the host after configuration changes. File status
`configured` is deliberately distinct from `hostVerification: unverified`.
Removing the generated Skill or MCP block does not remove Sestina Core data.


## Agent Corrector companion

`canonical/agent-corrector/` contains the host-neutral companion and its bounded
references. The same generator produces `hosts/codex/agent-corrector/` and the
TypeScript exports. Both Skill families are checked by `generate --check`.

Agent Corrector provides temporary correction within the current agent. A user
may explicitly hand off a public proposal through the same Review envelope used
by manual import and the temporary Host bridge. Repeating an invocation preserves
one draft. The Skill does not confirm outbound content, select Memory, call a
Provider or commit research changes; the public MCP surface remains read-only.
Host restarts and hooks never resubmit or retry automatically. No model benchmark
or claim of independent supervision accompanies this integration.
