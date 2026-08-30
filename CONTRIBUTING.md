# Contributing to Sestina

Thank you for helping improve Sestina. Contributions should make the local
research workflow clearer, safer, or more reliable while preserving user-only
research authority.

## Before you open a change

- Read the [product definition](docs/product/CURRENT-PRODUCT-DEFINITION.md),
  [architecture overview](docs/ARCHITECTURE.md), [privacy contract](PRIVACY.md),
  and [security policy](SECURITY.md).
- Search existing issues before opening a new one.
- Use a focused issue or pull request. Explain the user problem, the authority
  and data-flow impact, the failure behavior, and how you verified it.
- For vulnerabilities, do not open a public issue; follow [SECURITY.md](SECURITY.md).

## Development setup

Sestina requires Node.js 24.x and pnpm 11.16.0 through Corepack.

```text
corepack enable
pnpm install --frozen-lockfile
pnpm verify:public
```

Useful focused commands include `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm docs:check`, and `pnpm --filter @sestina/research-room build`.

## Change requirements

- Add a failing regression test before changing behavior, then make it pass.
- Keep research rules in the Kernel and integrations thin.
- Preserve backward-compatible project migrations and fail closed on data that
  cannot be proved safe to interpret.
- Keep Provider use explicit and bound to the exact Context Manifest the user
  reviewed. Do not add automatic retry, fallback, discovery, or upload.
- Do not let model output mutate a Decision, Issue, Review disposition, Appeal
  resolution, Deliberation resolution, or active Brief.
- Update user documentation and release notes for user-visible changes.
- For UI changes, verify the built production route, relevant workflows,
  languages, themes, responsive desktop widths, keyboard behavior, long
  content, recovery states, and 200% text.

## Privacy-safe reports and fixtures

Use synthetic data only. Never commit or paste:

- unpublished research or a real Research Brief;
- a `.sestina` database, backup, or exported private session;
- Provider requests/responses, API keys, tokens, cookies, or credentials;
- personal absolute paths, usernames, device identifiers, or raw logs;
- screenshots containing private material.

Reduce a bug to the smallest synthetic reproduction. Redact paths and secrets
before sharing command output.

## Pull request checklist

- [ ] The change has a clear user-facing purpose.
- [ ] Authority, privacy, and failure behavior remain explicit.
- [ ] Tests cover the change and the relevant public gate passes.
- [ ] Documentation, schemas, and migration guidance are synchronized.
- [ ] No private data, generated state, or unrelated files are included.
- [ ] Commit metadata is suitable for a permanent public history.

Unless explicitly stated otherwise, submitted contributions are licensed under
the repository's [Apache License 2.0](LICENSE).
