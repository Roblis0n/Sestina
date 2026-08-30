# Local-first guarantee

## Enforced production defaults

Sestina's production manifest sets the network default to denied and disables automatic telemetry, crash reporting/upload, background research-content logging, automatic upload, and authority mutation by external models. The default state directory is `.sestina/`; managed recovery bundles are under `.sestina/backups/`.

The following paths work without outbound networking:

- Core and CLI initialization and local research lifecycle operations;
- deterministic review, local report rendering, and local Capsule export/import;
- `privacy show`, `doctor`, and `data status|backup|restore`;
- static project-scoped `connect`, ordinary `connection-status`, and `disconnect`;
- read-only stdio MCP `health` and `get_research_context` plus its single Brief resource;
- Closed External App Pilot preflight, exact Manifest generation, local confirmation state, candidate/Review/disposition persistence, failure recovery, Search/Attention projection, and redacted evidence export when the Host attempt itself is not launched;
- all four offline demonstrations.

`scripts/verify-no-network.mjs` enforces this at runtime after the CLI and MCP are built. A Node preload blocks `fetch`, HTTP/HTTPS, TCP, TLS, DNS, WebSocket, and UDP entry points. The verifier first runs a synthetic outbound canary and requires it to fail with the blocked call category. It then runs only synthetic temporary projects through the default workflows under the same guard and deletes all temporary state. A network attempt in a guarded workflow makes the verification command fail.

This guarantee does not cover the explicitly external command `connection-status --verify-host --yes`, a user explicitly launching a confirmed Closed External App Pilot attempt, a user actively using another Codex model host, or a Research Room assessment that the user has explicitly configured, previewed through an exact Context Manifest, and confirmed. Saving/deleting Provider configuration and opening or recording an Appeal remain local; the connection test is metadata-only `GET /models`. There is no background probe, automatic fallback, discovery, or research-content retry.

An RI-52 Host attempt can call an external Codex model service only after the UI displays the exact frozen payload and the user confirms one Manifest/attempt/hash. Working Memory selection defaults to zero and `never_send` cannot enter. The process is ephemeral and read-only; failure, cancel, timeout, stale state, or application restart never triggers automatic retry. A second continuity attempt requires another preview and confirmation.

## Authority and semantic limits

No host, model, MCP result, Capsule response, Semantic Judge assessment, second opinion, or deterministic comparison can mutate user research authority. MCP remains two read-only tools and one read-only resource. The BYOK Research Room Provider path is available but disabled by default and requires exact per-request confirmation; no configured Provider means `ledger_only` / `appeal_record_only`, not semantic proof. The local-model runtime remains unavailable.

Closed Pilot output is fixed to `model_proposed` or `host_observation` with `canMutateAuthority=false`. Import binds the existing Review but is not acceptance. Only the existing user Authority Gate can commit a disposition and Receipt. A successful Codex session does not prove Sestina Provider availability, research correctness, external-user value, or repeatable second-use value.

## No hidden deletion or upload

There is no retry queue, background upload task, automatic crash report, or uninstall lifecycle that removes project state. `disconnect` changes only managed host configuration. Project data and backups remain until the user deliberately manages them through the filesystem.

See [DATA-FLOW.md](DATA-FLOW.md), [the privacy policy](../../PRIVACY.md), and [backup/restore operations](../recovery/BACKUP-RESTORE.md).
