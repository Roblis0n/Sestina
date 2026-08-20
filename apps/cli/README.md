# @sestina/cli

Offline command-line access to the Sestina research revision lifecycle. The
CLI opens one project-local `.sestina/state.sqlite` database and calls
`@sestina/core` for every business operation; it does not connect to a model or
network service.

## Project-scoped Codex connection

RI-39 adds one Tier A host workflow:

```text
sestina connect [--project <dir>] [--host codex] [--yes] [--json]
sestina connection-status [--project <dir>] [--host codex] [--json]
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
contract; it does not mean Codex loaded them. `hostVerification` therefore
remains `unverified` until the separate host E2E is completed.

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

The executable supports project initialization and diagnosis; Brief,
Artifact, Revision, and Episode preparation; Decision and Issue authority
transitions; deterministic Review runs; explicit Episode dispositions and
scoped waivers; immutable Snapshot creation and hash verification; standalone
Markdown/JSON reports; and minimized Capsule export/import.

Run `sestina help` for the command groups. Use `--json` for stable machine
output. Any action that changes user authority requires `--yes`; imported
Capsule responses remain `model_proposed` candidates and cannot mutate
authoritative research state.
