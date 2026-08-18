# @sestina/research

Pure TypeScript research domain primitives for Sestina.

- No filesystem, database, environment variable or network access.
- No model/provider calls of any kind.
- No imports from the legacy agent-governance packages.
- Time enters through the injected `Clock` port; ids through `IdFactory`.
- The public API is exported only from `src/index.ts`; consumers must import from the package root.
