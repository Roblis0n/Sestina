# MCP and host integration

Sestina's external-host boundary is deliberately narrow. It provides access to
current, project-bound research context while keeping all authority-bearing
commands inside the local Research Room and Kernel.

## Public MCP surface

The schema-25 candidate keeps this read-only surface. Core supplies a consistent
canonical snapshot even while the desktop owns the writer lease. Its context
includes the source revision and canonical hash; Memory bodies, exact outbound
requests and raw Provider responses are excluded. A new read observes committed
desktop changes without creating a second research writer.

The desktop Host draft bridge is a separate, explicit, ten-minute grant. It is
off at startup and closes with the project. It admits linked drafts and their
status only. The existing companion Skill and Agent Corrector remain proposal
producers; they cannot confirm a Manifest or commit a decision. The desktop
installer does not yet include a standalone MCP launcher; source-development
MCP setup below remains separate from installing the desktop application.

The stdio server exposes exactly:

- tool `health`;
- tool `get_research_context`;
- resource `sestina://research/current-brief`.

All three operations are read-only. Returned research text is untrusted content,
not an instruction source. MCP clients cannot activate a Brief, mutate a
Decision or Issue, dispose a Review, resolve an Appeal or Deliberation Room, or
change project memory.

## Safety properties

- Canonical path containment and project identity are checked before reads.
- Output is bounded and redacted according to the selected public contract.
- Frozen host invocations bind project ID, Context Manifest hash, purpose,
  configuration, and a one-attempt confirmation.
- Cancel, timeout, stale state, malformed output, and restart uncertainty fail
  closed. No automatic retry or fallback is performed.
- Host output enters Sestina only as a `model_proposed` candidate with
  provenance. Existing Review and Authority Gate workflows still apply.

## Local development

Build the MCP adapter from the repository root:

```text
pnpm --filter @sestina/mcp build
```

Implementation and contract details live in `integrations/mcp`. The generated
Codex-oriented research-integrity skill lives in `integrations/skills`; it is an
adapter to Sestina's public contract, not a second policy engine.

See the [MCP threat model](../security/MCP-THREAT-MODEL.md),
[data-flow inventory](../security/DATA-FLOW.md), and
[privacy contract](../../PRIVACY.md).
