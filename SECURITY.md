# Security policy

Supported public-preview version: `0.2.0`. Security fixes are applied to the
current public-preview line; older private candidates are not supported public
distribution channels. / 当前支持的公开预览版本为 `0.2.0`；旧私有候选不属于受
支持的公开分发渠道。

Sestina is a local research-process debugger. Its security boundary is the local project, the project-owned `.sestina/` state directory, explicitly generated project-scoped Codex configuration, and the two-tool/one-resource read-only MCP surface. External models, host responses, and Capsule responses cannot mutate research authority.

## Reporting a vulnerability

Report vulnerabilities through the repository's [private GitHub Security Advisory form](https://github.com/Roblis0n/Sestina/security/advisories/new). Do not put a vulnerability report in a public GitHub Issue.

Use a synthetic reproduction. Never attach unpublished research content, a real `.sestina/` database, a Research Brief, a Provider response, a secret, token, API key, host credentials, project path, personal absolute path, device identifier, raw logs, stdout/stderr, or a private screenshot. A useful report includes the affected command, the expected boundary, the observed safe synthetic result, the supported operating system and Node version, and the smallest reproduction that demonstrates the problem.

请只使用合成复现；禁止提交研究内容、真实 `.sestina` 数据库、Research Brief、
Provider 响应、密钥/token/API key、项目或个人路径、设备标识、原始日志、
stdout/stderr 或隐私截图。

## Current security boundaries

- The default Core, CLI, deterministic review, backup/restore, Capsule file operations, and stdio MCP do not require a network connection.
- `connection-status --verify-host --yes` is an explicit exception: it starts a Codex host/model operation and may send the bounded categories declared by `sestina privacy show` to the user-selected Codex model provider.
- Research Room Semantic Judge and second-opinion calls are explicit exceptions only after separate user configuration, an exact user-visible Context Manifest, and confirmation of that bound request. Saving config performs no probe; connection testing is metadata-only `GET /models`. No automatic discovery, fallback, retry, or background research request is allowed.
- A RI-50 Deliberation Room freezes two exact participant requests before either result is accepted. Each request excludes the other participant's output, private Context, and session; user-only Resolution data is excluded from both. Both Manifests require explicit confirmation, tool/file/shell/search access is disabled, total calls are capped at four, and there is no automatic retry/fallback or third synthesis call.
- The original Judge and second-opinion connection have separate config generations, secret references, and runtime identities. Same-runtime or unverifiable identity cannot be labelled independent. Provider raw responses, authentication headers, hidden reasoning, and full network payloads are not persisted.
- A Provider assessment, comparison, signature, or agreement cannot resolve an appeal or mutate the original Finding. Only an expected-version direct-user command with a public reason can create the append-only Resolution.
- Deliberation attempts use project/room/round/participant/request/hash binding, idempotent command receipts, expected-version CAS, and late-result fencing. Same-runtime, stale, cancelled, restart-uncertain, cross-project, malformed, duplicate, or oversized results fail closed. Difference is deterministic Core output, not a security or authority verdict; only a direct user command can append Room Resolution.
- MCP exposes exactly `health`, `get_research_context`, and `sestina://research/current-brief`. All are read-only; research text is untrusted data and conveys no authority.
- Restore accepts only a managed backup ID. It verifies containment, strict manifest shape, hashes, SQLite integrity, schema and project/Brief binding before committing.
- SQLite database open failures are classified as unavailable, read-only, busy/locked, corrupt, or generic storage failure. Failed open/migration preserves existing files; corrupt authority state fails closed instead of being guessed or rebuilt.
- Secret storage remains delegated to the existing DPAPI, Keychain, Secret Service, or explicit environment backend. Recovery bundles contain project research state, not host authentication stores.
- Automatic telemetry, automatic crash upload, session replay, background content logging, and automatic upload are disabled. The package gate rejects known automatic telemetry/crash-upload SDKs and uninstall lifecycle scripts.

See [PRIVACY.md](PRIVACY.md), [the local-first guarantee](docs/security/LOCAL-FIRST-GUARANTEE.md), [the data-flow inventory](docs/security/DATA-FLOW.md), and [backup and restore](docs/recovery/BACKUP-RESTORE.md).
