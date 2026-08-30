# Working on Sestina

This file is the public repository instruction entry for coding agents and
contributors. Keep changes aligned with the product described in `README.md`
and `docs/product/CURRENT-PRODUCT-DEFINITION.md`.

## Product invariants

- Sestina is a local, interactive research application. Research Room is the
  primary interface; the Research Deliberation Kernel owns research state and
  rules.
- The user is the only research authority. A model, agent, tool, signature,
  hash, or consensus may provide a proposal or evidence, but may not accept,
  resolve, waive, close, supersede, or redirect research on the user's behalf.
- Missing evidence is reported as unknown or unproven. Never fabricate a
  Provider result, external-user result, or semantic-quality claim.
- Project state is local by default. Outbound Context must be explicit,
  inspectable, purpose-bound, and user-confirmed. Do not add telemetry,
  automatic upload, hidden logging, background sync, or automatic retry.
- CLI, MCP, Skills, and host adapters stay thin. Business rules belong in the
  Kernel, and the public MCP surface remains read-only.
- Do not collect, expose, or persist hidden reasoning. Store only public,
  structured reasons and provenance that users can inspect.

## Before changing code

1. Read the relevant product, architecture, privacy, and security documents.
2. Identify the user-visible product increment and its authority/data flow.
3. Preserve existing project data, migrations, receipts, and failure behavior.
4. Add a failing test for behavioral changes before implementing the change.

## Implementation boundaries

- Use public package entry points; do not reach across package roots with
  relative imports or private subpaths.
- Renderer code consumes typed API projections. It must not import storage,
  secrets, Provider runtimes, or Core internals.
- Validate untrusted files, HTTP payloads, Provider output, MCP content, and
  archive entries at the boundary. Fail closed on malformed, stale,
  cross-project, oversized, or future-schema input.
- Never overwrite an unknown `.sestina` directory or infer authority from an
  incomplete/corrupt store.
- Keep fixtures synthetic. Do not commit credentials, real research material,
  databases, logs, absolute personal paths, or Provider raw responses.
- Update contracts, schemas, tests, documentation, and migration guidance when
  an interface changes.

## Verification

Run the smallest relevant test while iterating, then complete the public gate:

```text
pnpm verify:public
```

Release-affecting changes must also pass the platform gate on every supported
target and produce deterministic, verified archives:

```text
pnpm verify:platform <win32|darwin|linux> <x64|arm64>
```

Inspect production UI changes in the real built Research Room across affected
states, English and Chinese, light/dark/high-contrast modes, desktop widths,
long content, keyboard use, and 200% text. Source review, snapshots, or generated
screenshots alone are not visual acceptance.

## Git and release hygiene

- Preserve unrelated and untracked work. Stage only files belonging to the
  change.
- Do not commit generated project state, release output, test output, or local
  configuration.
- Do not weaken privacy, security, history, license, or artifact checks to make
  a build pass.
- Published artifacts must match the tag commit and the checksums attached to
  the same GitHub Release.
