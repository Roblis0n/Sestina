# `@sestina/skills`

This private workspace package owns Sestina's host-neutral research-integrity instructions and deterministic Codex artifacts.

- `canonical/research-integrity.md` is the only hand-maintained Skill body.
- `pnpm --filter @sestina/skills generate` refreshes the Codex host copy and the TypeScript constants consumed by the CLI.
- `pnpm --filter @sestina/skills check` is read-only and fails when a generated artifact drifts.
- The generated Skill contains no project Brief, project path, account, secret, benchmark, or provider data.

The project-scoped Codex installation is `.agents/skills/sestina-research-integrity/`. Its metadata declares a dependency on the local read-only MCP server named `sestina`; it does not add network access or write capabilities.

The companion CLI writes the project MCP block to `.codex/config.toml`. Codex
must trust the project before project configuration is loaded, and users must
reopen or restart the host after configuration changes. File status
`configured` is deliberately distinct from `hostVerification: unverified`.
Removing the generated Skill or MCP block does not remove Sestina Core data.
