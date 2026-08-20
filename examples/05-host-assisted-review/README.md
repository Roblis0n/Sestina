# Anonymous host-assisted review example

This example contains only synthetic research text. It demonstrates the handoff boundary: Codex reads the current Sestina context and returns a structured candidate; the local CLI registers that candidate, runs deterministic review, and waits for an explicit user action.

Build the repository-local binaries first:

```powershell
pnpm --filter @sestina/mcp build
pnpm --filter @sestina/cli build
```

Create a temporary project with `sestina init`, copy `baseline.md` into it, and replace the illustrative all-zero project ID in `research-brief.template.yaml` with the returned project ID before activating the Brief. Then use the CLI's `artifact add`, `episode start`, `connect --yes`, and `connection-status --verify-host --yes` commands described in [`docs/getting-started/codex.md`](../../docs/getting-started/codex.md).

For the host candidate, run a new read-only Codex session with [`candidate-output.schema.json`](candidate-output.schema.json). The stable output fields are:

- `candidateMarkdown`: candidate research text, not an authoritative write;
- `materialDelta`: what substantive relation changed;
- `preservedDecisionIds`: current accepted/frozen Decision IDs preserved by the candidate;
- `reopenResolvedIssue`: `false` unless a recorded reopen condition is satisfied;
- `authority: "model_proposed"` and `canMutateAuthority: false`.

The E2E equivalents are `pnpm test:e2e:ri40` for the offline deterministic workflow and `pnpm test:e2e:codex` for real Codex. The latter fails rather than skipping when Codex cannot start or its JSONL contains no successful Sestina MCP call.
