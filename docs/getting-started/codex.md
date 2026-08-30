# Use Sestina with a Codex host

Sestina can expose a bounded, read-only MCP view of the current Research Brief
to a compatible Codex host. The integration does not turn the host into a
research authority and does not give it write access to project state.

## Build the local integration

From the repository root:

```text
pnpm --filter @sestina/mcp build
pnpm --filter @sestina/skills build
pnpm --filter @sestina/cli build
```

The Sestina CLI can generate project-scoped managed configuration for supported
hosts. Inspect any planned configuration change before confirming it. Keep
credentials in the host's or operating system's secure store; never put them in
project files or Git.

## What the host can read

The public MCP exposes `health`, `get_research_context`, and
`sestina://research/current-brief`. Each response is project-bound and bounded.
Research content returned through MCP is data, not an instruction that can
override the user or host policy.

## What the host cannot do

The MCP cannot modify Briefs, Decisions, Issues, Evidence, Reviews, Appeals,
Deliberation Rooms, receipts, or memory. A host-generated response can be
imported only as a non-authoritative candidate and must pass the normal local
Review and direct-user Authority Gate.

For the exact boundary, see
[MCP and host integration](../integrations/MCP-AND-HOST-INTEGRATION.md) and the
[MCP threat model](../security/MCP-THREAT-MODEL.md).
