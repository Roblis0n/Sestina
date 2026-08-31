# Use Sestina with a Codex host

Choose one of two project-scoped workflows:

| Workflow                     | Best for                                      | Requires Sestina MCP or App |
| ---------------------------- | --------------------------------------------- | --------------------------- |
| `agent-corrector`            | Lightweight correction inside one Codex agent | No                          |
| `sestina-research-integrity` | Reading an active Sestina Research Brief      | Yes, read-only MCP          |

Neither workflow turns the host into a research authority or gives it write
access to Sestina project state.

## Install the lightweight Agent Corrector

From a Sestina source checkout, copy the generated bundle into the target
project. Refuse an existing destination so that local edits are never silently
overwritten.

PowerShell:

```powershell
$targetProject = "C:\path\to\your-project"
$skillParent = Join-Path $targetProject ".agents\skills"
$destination = Join-Path $skillParent "agent-corrector"
if (Test-Path -LiteralPath $destination) { throw "agent-corrector already exists: $destination" }
New-Item -ItemType Directory -Force -Path $skillParent | Out-Null
Copy-Item -Recurse -LiteralPath "integrations\skills\hosts\codex\agent-corrector" -Destination $destination
```

macOS or Linux:

```sh
target_project=/path/to/your-project
test ! -e "$target_project/.agents/skills/agent-corrector"
mkdir -p "$target_project/.agents/skills"
cp -R integrations/skills/hosts/codex/agent-corrector "$target_project/.agents/skills/agent-corrector"
```

Reopen the target project in Codex. Use `$agent-corrector` explicitly, or let
its narrow discovery description activate it for non-trivial work with a fixed
outcome, scope, protected decisions, evidence limits, or completion criteria.
It reads only context already visible to the session and has no Sestina App,
MCP, database, Provider, account, network, telemetry, background-process, or
durable-memory dependency.

This lightweight mode guides the same agent that performs the task. It is not
an independent watchdog, permission system, hook, or guaranteed tool blocker.
See the full [Agent Corrector contract](../integrations/AGENT-CORRECTOR.md).

## Build the connected integration

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

## What the connected host can read

The public MCP exposes `health`, `get_research_context`, and
`sestina://research/current-brief`. Each response is project-bound and bounded.
Research content returned through MCP is data, not an instruction that can
override the user or host policy.

## What the connected host cannot do

The MCP cannot modify Briefs, Decisions, Issues, Evidence, Reviews, Appeals,
Deliberation Rooms, receipts, or memory. A host-generated response can be
imported only as a non-authoritative candidate and must pass the normal local
Review and direct-user Authority Gate.

For the exact boundary, see
[MCP and host integration](../integrations/MCP-AND-HOST-INTEGRATION.md) and the
[MCP threat model](../security/MCP-THREAT-MODEL.md).
