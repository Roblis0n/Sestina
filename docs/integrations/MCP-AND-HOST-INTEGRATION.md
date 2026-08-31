# MCP and host integration

Sestina's external-host boundary is deliberately narrow. It provides access to
current, project-bound research context while keeping all authority-bearing
commands inside the local Research Room and Kernel.

## Public MCP surface

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
MCP-backed `sestina-research-integrity` Skill lives in `integrations/skills`;
it is an adapter to Sestina's public contract, not a second policy engine.

The same package also ships [`agent-corrector`](AGENT-CORRECTOR.md) as a
separate lightweight choice. It works only from context visible to the current
Codex session and does not connect to this MCP surface, the Research Room, the
Kernel, a database, or a Provider. Installing it neither configures Sestina nor
changes the authority boundary above.

See the [MCP threat model](../security/MCP-THREAT-MODEL.md),
[data-flow inventory](../security/DATA-FLOW.md), and
[privacy contract](../../PRIVACY.md).
