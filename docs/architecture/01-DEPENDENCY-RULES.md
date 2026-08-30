# Dependency and authority boundaries

Sestina uses a layered workspace so product rules have one owner and external
interfaces remain replaceable.

## Dependency direction

```text
apps / integrations
        |
        v
      core
        |
        v
research + review + reports + storage ports
        |
        v
schema and small leaf utilities
```

- `packages/research` owns research entities and legal user-authority
  transitions.
- `packages/core` orchestrates use cases and transactions through public ports.
- `packages/storage` persists state and migrations; it does not decide research
  policy.
- `packages/review` derives deterministic findings and validates optional
  semantic-review data; it cannot commit authority changes.
- applications and integrations call public package entry points. They do not
  import another package's private subpaths or escape package roots with
  relative imports.
- renderer code consumes validated HTTP projections and never imports Core,
  storage, secret backends, or Provider runtimes.

The executable repository check is `pnpm repo:check`; import boundaries also
have fixture-based tests under `tests/repository`.

## Authority flow

Every authority-bearing command includes the project, object identity,
expected version, direct-user actor, explicit intent, and a public reason. Core
checks the legal transition and commits state plus its receipt atomically.
Models, host adapters, HTTP clients, and UI components cannot bypass this path.

## Untrusted boundaries

The following inputs are treated as untrusted and validated before use:

- project and export paths;
- SQLite state and migration versions;
- HTTP requests and responses;
- Provider envelopes and cited spans;
- MCP requests and resource content;
- Capsules, backups, manifests, and release archives.

Malformed, oversized, stale, cross-project, duplicate, or future-schema input
fails closed. Existing user files are preserved when a directory cannot be
proved to be a valid Sestina project.

## Verification entry points

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:check
pnpm repo:check
pnpm verify:architecture
pnpm verify:repository
pnpm verify:public-history
```

`pnpm verify:public` runs the deterministic shared release gate. Supported
platform archives additionally run `pnpm verify:platform` on the matching
operating system and architecture.
