# @sestina/cli

Command-line access to the Sestina research revision lifecycle. The CLI opens
one project-local `.sestina/state.sqlite` database and calls `@sestina/core` for
every business operation. Ordinary commands remain local and offline. Only the
explicit `connection-status --verify-host --yes` path starts a bounded Codex
model call.

## Private-preview installation

Install the supplied npm-compatible tarball with Node.js 24. The package is not
published to the public npm registry.

```sh
npm install --global ./sestina-cli-0.1.0.tgz --ignore-scripts --offline
sestina --version --json
```

The installed package is self-contained, including the production read-only MCP
server. It has no install lifecycle script, telemetry, background service,
network upload, crash upload, or update check. Uninstalling `@sestina/cli`
preserves all project data. See the release bundle's Windows, macOS, or Linux
guide for the complete fresh-install workflow.

## Project-scoped Codex connection

RI-39 adds one Tier A host workflow:

```text
sestina connect [--project <dir>] [--host codex] [--yes] [--json]
sestina connection-status [--project <dir>] [--host codex] [--verify-host] [--codex-executable <absolute-path>] [--yes] [--json]
sestina disconnect [--project <dir>] [--host codex] [--yes] [--json]
```

`connect` installs the generated Skill at
`.agents/skills/sestina-research-integrity/` and adds one marked
`[mcp_servers.sestina]` block to the project's `.codex/config.toml`. It never
edits the user's global `~/.codex/config.toml`, project trust, or any other MCP
server. A real change requires `--yes`; without it, the CLI emits only a plan
containing relative paths.

Codex loads project `.codex` configuration only after the project is trusted.
Reopen or restart Codex after a connect or disconnect. A reported
`configuration: configured` means the project files match the generated
contract; it does not mean Codex loaded them. Ordinary status therefore keeps
`hostVerification: unverified`. Explicit verification without `--yes` starts
nothing and returns confirmation-required. With `--verify-host --yes`, the CLI
uses a fresh read-only `codex exec --ephemeral` process and returns `verified`
only after successful JSONL MCP events for both `health` and
`get_research_context` plus an exact project/Brief binding. The invocation-only
trust and MCP launch overrides are not written to user configuration.

`--codex-executable` is accepted only together with `--verify-host --yes` and
must be an absolute path. Native `codex` binaries are launched directly. An
official npm `@openai/codex/bin/codex.js` launcher, or its adjacent `codex.cmd`
shim, is resolved to the JavaScript launcher and run through the current Node
executable without executing or parsing the shell shim. Other scripts, missing
paths, directories, and relative paths fail closed. The real E2E selects this
same production path through `SESTINA_CODEX_EXECUTABLE`; that variable is a test
harness input, not a separate launch implementation.

The managed TOML editor preserves every byte outside the Sestina marker block,
including comments, formatting, and other MCP servers. Foreign ownership,
malformed markers, modified Skills, and project-escaping links fail closed.
Changed existing targets receive local exact-byte backups before an atomic,
rollback-capable transaction. An idempotent connect does not change mtimes or
create a backup.

`disconnect` removes only an unmodified generated Skill and the Sestina marker
block. It preserves later user edits outside that block and never deletes the
project's `.sestina` directory, database, Research Brief, or research objects.
The MCP configured by this workflow remains read-only and enables only
`health` and `get_research_context`.

The separate lightweight `agent-corrector` Skill is not managed by
`sestina connect` or `sestina disconnect`. It has no MCP dependency and is installed
manually at `.agents/skills/agent-corrector/`; disconnecting the MCP-backed
workflow does not remove or modify it.

The executable supports project initialization and diagnosis; Brief,
Artifact, Revision, and Episode preparation; Decision and Issue authority
transitions; deterministic Review runs; explicit Episode dispositions and
scoped waivers; immutable Snapshot creation and hash verification; standalone
Markdown/JSON reports; and minimized Capsule export/import.

Run `sestina help` for the command groups. Use `--json` for stable machine
output. Any action that changes user authority requires `--yes`; imported
Capsule responses remain `model_proposed` candidates and cannot mutate
authoritative research state.

The 0.2.0 public-preview Research Room archive includes bilingual platform,
security, support, and recovery guides. CLI remains a subordinate diagnostic
and recovery interface; it is not separately published to npm.
